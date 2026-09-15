import { validateInteractiveFilters, applyInteractiveFilters, type InteractiveFilter, type QueryFilter, filterSql } from './filters.js'
import { validateLiveRendering } from './render-validation.js'
import { LiveDiagnosticError } from './diagnostics.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { KnowledgeLibrary } from '../library/knowledge-library.js'
import { connection, describe, fingerprint, parseRows, runtime, type Row } from './mcp.js'
import { renderLive } from './view.js'
import { validateProvenance, type Provenance } from './provenance.js'
import { bindLivePage } from './page.js'
export type QueryDefinition = { id: string; metrics: LiveSpec['metrics']; groupBy?: string[]; dateField?: string; orderBy?: { field: string; direction: 'asc'|'desc' }; limit?: number }
export type LiveSpec = { title: string; table: string; datasource: string; metrics: Array<{ field: string; aggregate: 'sum'|'avg'|'min'|'max'|'count'|'count_distinct'|'latest_sum'; label: string; definition: string; unit?: string }>; dateField?: string; dimension?: string; filters?: QueryFilter[]; refreshSeconds: number; queries?: QueryDefinition[]; interactiveFilters?: InteractiveFilter[] }
type Binding = { id: string; scope: string; spec: LiveSpec; assetId?: string; revision?: string; plan?: { dialect: string; queries: ReturnType<typeof buildQueries>; elements: Provenance["elements"] } }
type Share = { id: string; binding: string; scope: string; revision: string; assetId: string; expiresAt: string; revoked: boolean; hash: string }
const identifier = (v: unknown) => typeof v === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v)
const literal = (v: string|number) => typeof v === 'number' ? String(v) : "'" + v.replace(/'/g, "''") + "'"
export function validateSpec(input: unknown): LiveSpec {
  const s = JSON.parse(JSON.stringify(input ?? null)) as LiveSpec
  if(s?.queries && !s.metrics) s.metrics=s.queries[0]?.metrics
  if(s?.queries && !s.dateField) s.dateField=s.queries[0]?.dateField
  if (!s || typeof s !== 'object' || typeof s.title !== 'string' || !s.title.trim() || s.title.length > 160 || typeof s.datasource !== 'string' || !/^[\w-]{1,80}$/.test(s.datasource) || typeof s.table !== 'string' || !/^\w+\.\w+$/.test(s.table)) throw Error('实时看板数据源、表名或标题无效')
  if (!Array.isArray(s.metrics) || s.metrics.length < 1 || s.metrics.length > 6) throw Error('请选择 1–6 个指标')
  for (const m of s.metrics) if (!identifier(m.field) || !['sum','avg','min','max','count','count_distinct','latest_sum'].includes(m.aggregate) || typeof m.label !== 'string' || !m.label || m.label.length > 80 || typeof m.definition !== 'string' || !m.definition.trim() || m.definition.length > 500 || (m.unit !== undefined && (typeof m.unit !== 'string' || m.unit.length > 20))) throw Error('指标字段、聚合或口径说明无效')
  if ((s.dateField && !identifier(s.dateField)) || (s.dimension && !identifier(s.dimension))) throw Error('维度字段无效')
  if (s.metrics.some(m => m.aggregate === 'latest_sum') && !s.dateField) throw Error('期末库存等快照指标必须指定日期字段')
  if (!Array.isArray(s.filters ?? []) || (s.filters?.length ?? 0) > 8) throw Error('最多 8 个筛选条件')
  for (const f of s.filters ?? []) if (!identifier(f.field) || !['eq','gte','lte'].includes(f.op) || !['string','number'].includes(typeof f.value) || (typeof f.value === 'string' && f.value.length > 200) || (typeof f.value === 'number' && !Number.isFinite(f.value))) throw Error('筛选条件无效')
  if (![60,300,900,3600].includes(s.refreshSeconds)) throw Error('刷新间隔请选择 60、300、900 或 3600 秒')
  if(s.queries!==undefined){
    if(!Array.isArray(s.queries)||!s.queries.length||s.queries.length>16)throw Error('queries 必须包含1–16组查询')
    const ids=new Set<string>()
    for(const [i,d] of s.queries.entries()){
      if(!d||!/^q_[a-z][a-z0-9_]{0,45}$/.test(d.id)||ids.has(d.id))throw Error('queries['+i+'].id 必须唯一且以q_开头')
      ids.add(d.id)
      if(Object.keys(d).some(k=>!['id','metrics','groupBy','dateField','orderBy','limit'].includes(k)))throw Error('查询包含未支持属性：'+d.id)
      validateSpec({...s,queries:undefined,metrics:d.metrics,dateField:d.dateField,dimension:undefined})
      if(d.groupBy!==undefined&&(!Array.isArray(d.groupBy)||d.groupBy.length>3||new Set(d.groupBy).size!==d.groupBy.length||d.groupBy.some(f=>!identifier(f))))throw Error('查询分组字段无效：'+d.id)
      if(d.limit!==undefined&&(!Number.isInteger(d.limit)||d.limit<1||d.limit>5000))throw Error('查询limit须为1–5000：'+d.id)
      const aliases=[...d.metrics.map((_,i)=>'m'+i),...(d.groupBy??[]).map((_,i)=>i?'d'+i:'bucket')]
      if(d.orderBy&&(!aliases.includes(d.orderBy.field)||!['asc','desc'].includes(d.orderBy.direction)))throw Error('查询排序别名无效：'+d.id)
    }
  }
  validateInteractiveFilters(s.interactiveFilters)
  return JSON.parse(JSON.stringify(s)) as LiveSpec
}
export function buildQueries(s: LiveSpec, dialect: string): Record<string,string|undefined> {
  if(s.queries){
    const quote=dialect==='postgresql'?'"':'`', q=(v:string)=>quote+v+quote
    return Object.fromEntries(s.queries.map(d=>{
      const legacy=buildQueries({...s,queries:undefined,metrics:d.metrics,dateField:d.dateField,dimension:undefined},dialect).totals!
      const groups=d.groupBy??[]
      if(!groups.length)return [d.id,legacy]
      const from=legacy.lastIndexOf(' FROM '+s.table)
      const projection=legacy.slice(7,from)
      const sql='SELECT '+groups.map((f,i)=>q(f)+' AS '+(i?'d'+i:'bucket')).join(', ')+', '+projection+legacy.slice(from)+' GROUP BY '+groups.map(q).join(', ')
      const order=d.orderBy??{field:'m0',direction:'desc'}
      return [d.id,sql+' ORDER BY '+q(order.field)+' '+order.direction.toUpperCase()+', '+groups.map(q).join(', ')+' LIMIT '+(d.limit??20)]
    }))
  }
  const quote = dialect === 'postgresql' ? '"' : '`', q = (v: string) => quote+v+quote
  const table = s.table
  const where = filterSql(s.filters??[],dialect)
  const expression = (m: LiveSpec['metrics'][number]) => m.aggregate === 'count_distinct' ? `COUNT(DISTINCT ${q(m.field)})` : m.aggregate === 'latest_sum' ? `SUM(CASE WHEN ${q(s.dateField!)} = (SELECT MAX(${q(s.dateField!)}) FROM ${table}${where ? ' WHERE '+where : ''}) THEN ${q(m.field)} ELSE NULL END)` : `${m.aggregate.toUpperCase()}(${q(m.field)})`
  const aggregate = s.metrics.map((m,i) => `${expression(m)} AS m${i}`).join(', ')
  const totals = `SELECT ${aggregate}, COUNT(*) AS records${s.dateField ? ', MAX('+q(s.dateField)+') AS data_date' : ''} FROM ${table}${where ? ' WHERE '+where : ''}`
  const trendMetrics = s.metrics.map((m,i) => ({m,i})).filter(x => x.m.aggregate !== 'latest_sum').map(({m,i}) => `${expression(m)} AS m${i}`).join(', ')
  const trend = s.dateField && trendMetrics ? `SELECT ${q(s.dateField)} AS bucket, ${trendMetrics} FROM ${table}${where ? ' WHERE '+where : ''} GROUP BY ${q(s.dateField)} ORDER BY ${q(s.dateField)} LIMIT 5000` : undefined
  const ranking = s.dimension ? `SELECT ${q(s.dimension)} AS bucket, ${aggregate} FROM ${table}${where ? ' WHERE '+where : ''} GROUP BY ${q(s.dimension)} ORDER BY m0 DESC LIMIT 20` : undefined
  return { totals, trend, ranking }
}
function checkSchema(s:LiveSpec,schema:Awaited<ReturnType<typeof describe>>) {
      for(const d of s.queries??[]){checkSchema({...s,queries:undefined,metrics:d.metrics,dateField:d.dateField,dimension:undefined},schema);for(const f of d.groupBy??[])if(!schema.fields.some(x=>x.name===f))throw Error('查询分组字段未授权：'+d.id+'.'+f)}
      const fields=new Map(schema.fields.map(f=>[f.name,f]))
      for (const name of [...s.metrics.map(m=>m.field),...(s.filters??[]).map(f=>f.field),...(s.interactiveFilters??[]).map(f=>f.field),s.dateField,s.dimension].filter(Boolean) as string[]) if (!fields.has(name)) throw Error('字段不在当前授权表结构中')
      for(const f of s.interactiveFilters??[]){
        const type=fields.get(f.field)!.type.toLowerCase(),text=/text|char|string/.test(type),numeric=/int|decimal|numeric|double|float|real|number/.test(type)
        if(f.type==='numberRange'&&!numeric)throw Error('数值筛选需要数值字段：'+f.id)
        if(f.type==='text'&&!text)throw Error('文本筛选需要文本字段：'+f.id)
        if(f.type==='boolean'&&!/bool/.test(type))throw Error('布尔筛选需要布尔字段：'+f.id)
        if(f.type==='monthRange'&&!text&&!/int/.test(type))throw Error('月份范围需要已核实格式的文本或整数：'+f.id)
        if(f.type==='monthRange'&&/int/.test(type)&&f.storageFormat!=='YYYYMM')throw Error('整数月份须使用YYYYMM')
        if(f.type==='dateRange'){
          const format=f.storageFormat??'date'
          if(format==='date'&&!/^date$/.test(type))throw Error('非DATE字段须明确storageFormat：'+f.id)
          if(format==='timestamp'&&!/timestamp|datetime/.test(type))throw Error('timestamp格式需要时间戳字段')
          if(format==='timestamp'&&/with time zone|timestamptz/.test(type)&&!f.utcOffset)throw Error('带时区时间戳须声明已核实的utcOffset')
          if(format==='timestamp'&&!/with time zone|timestamptz/.test(type)&&f.utcOffset)throw Error('无时区时间戳不接受偏移，请使用源表业务日期')
          if(['YYYY-MM-DD','YYYYMMDD'].includes(format)&&!text&&!(format==='YYYYMMDD'&&/int/.test(type)))throw Error('日期编码与字段类型不匹配')
        }
      }
      for (const m of s.metrics) if (['sum','avg','latest_sum'].includes(m.aggregate) && !/int|decimal|numeric|double|float|real|number/i.test(fields.get(m.field)!.type)) throw Error('求和或平均指标必须使用数值字段')
}
export class LiveService {
  private writing = Promise.resolve()
  constructor(readonly root: string, readonly library: KnowledgeLibrary) {}
  private async save(name: string, value: unknown) { await mkdir(join(this.root,'live'),{recursive:true}); const target=join(this.root,'live',name+'.json'),temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,target) }
  private async read<T>(name: string): Promise<T> { if (!/^[a-z0-9-]+$/.test(name)) throw Error('实时看板标识无效');return JSON.parse(await readFile(join(this.root,'live',name+'.json'),'utf8')) as T }
  async find(assetId: string, revision: string): Promise<Binding|undefined> {
    if (!/^[a-z][a-z0-9-]{2,62}$/.test(assetId) || !/^rev-\d{4}$/.test(revision)) return undefined
    try { return await this.read<Binding>('asset-'+assetId+'-'+revision) } catch (e) { if ((e as NodeJS.ErrnoException).code==='ENOENT') return undefined;throw e }
  }
  async query(id: string, filters?: unknown) {
    const binding=await this.read<Binding>('binding-'+id)
    return this.executeBinding(binding,true,filters)
  }
  async request(id:string,payload:unknown){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('查询请求必须为对象')
    const p=payload as Record<string,unknown>
    if(Object.keys(p).some(k=>!['filters','option','search','cursor'].includes(k)))throw Error('未知查询参数')
    return p.option===undefined?this.query(id,p.filters):this.options(id,p.option,p.filters,p.search,p.cursor)
  }
  async options(id:string,option:unknown,input?:unknown,search:unknown='',cursor:unknown=0){
    const binding=await this.read<Binding>('binding-'+id),scope=fingerprint(await connection())
    if(binding.scope!==scope)throw Error('数据源授权已变更')
    const base=validateSpec(binding.spec),definition=base.interactiveFilters?.find(f=>f.id===option)
    if(!definition?.dynamic)throw Error('该筛选未开放动态选项')
    if(typeof search!=='string'||search.length>100||/[\x00-\x1f]/.test(search)||typeof cursor!=='number'||!Number.isInteger(cursor)||cursor<0||cursor>10000)throw Error('选项搜索或分页参数无效')
    const normalized=applyInteractiveFilters(base,input),parents=new Set<string>()
    const add=(id:string)=>{if(parents.has(id))return;parents.add(id);for(const p of base.interactiveFilters!.find(f=>f.id===id)!.dependsOn??[])add(p)}
    for(const parent of definition.dependsOn??[])add(parent)
    const subset={...base,interactiveFilters:base.interactiveFilters!.filter(f=>parents.has(f.id))}
    const parentValues=Object.fromEntries([...parents].map(k=>[k,normalized.applied[k]]))
    const resolved=applyInteractiveFilters(subset,parentValues)
    return runtime.coalesce(scope+':options:'+id+':'+String(option)+':'+JSON.stringify([parentValues,search,cursor]),async()=>{
      const schema=await describe(base.table,base.datasource);checkSchema(base,schema)
      if(!['postgresql','starrocks'].includes(schema.dialect))throw Error('不支持的数据源方言')
      const q=(s:string)=>schema.dialect==='postgresql'?'"'+s+'"':'`'+s+'`'
      // Use a subquery to search/canonicalize primitive option values without interpolating expressions from clients.
      const where=filterSql([...resolved.spec.filters,{field:definition.field,op:'notNull',value:''}],schema.dialect)
      const cast='CAST('+q(definition.field)+' AS VARCHAR)'
      const searchClause=search?' WHERE '+filterSql([{field:'value',op:'contains',value:search}],schema.dialect):''
      const encoded=schema.dialect==='postgresql'?"CONCAT('v', ENCODE(CONVERT_TO("+q('value')+", 'UTF8'), 'hex'))":"CONCAT('v', HEX("+q('value')+"))"
      const sql='SELECT DISTINCT '+encoded+' AS '+q('option_hex')+' FROM (SELECT '+cast+' AS '+q('value')+' FROM '+base.table+' WHERE '+where+') AS options_source'+searchClause+' ORDER BY '+q('option_hex')+' LIMIT 51 OFFSET '+cursor
      const response=await runtime.call('query_data',{sql,datasource_name:base.datasource}),rows=parseRows(response.result)
      if(fingerprint(await connection())!==scope)throw Error('数据源授权已变更')
      return {filterId:definition.id,options:rows.slice(0,50).map(r=>{const encoded=r.option_hex;if(typeof encoded!=='string'||!/^v(?:[a-fA-F0-9]{2})*$/.test(encoded))throw Error('选项编码无效');const value=Buffer.from(encoded.slice(1),'hex').toString('utf8');return {label:value||'（空字符串）',value}}),nextCursor:rows.length>50&&cursor<10000?cursor+50:null,limitReached:rows.length>50&&cursor>=10000,truncated:rows.length>50,parentValues,timing:response.timing}
    })
  }
  private async executeBinding(binding:Binding, persist:boolean, filters?:unknown) {
    const id=binding.id,scope=fingerprint(await connection())
    if (binding.scope!==scope) throw Error('数据源授权已变更，请重新生成看板')
    const base=validateSpec(binding.spec),resolved=applyInteractiveFilters(base,filters),s=resolved.spec
    return runtime.coalesce(scope+':'+id+':'+JSON.stringify(resolved.applied),async()=>{
      const started=Date.now(),schema=await describe(s.table,s.datasource)
      if (!['postgresql','starrocks'].includes(schema.dialect)) throw Error('当前最小版只支持 PostgreSQL 和 StarRocks 数据源')
      checkSchema(s,schema)
      if(binding.plan && binding.plan.dialect!==schema.dialect)throw Error('数据源方言已变化，请重新生成看板')
      const queries=s.interactiveFilters?.length ? buildQueries(s,schema.dialect) : binding.plan?.queries ?? buildQueries(s,schema.dialect),timings: unknown[]=[],rows: Record<string,Row[]>={},pendingSql=new Map<string,ReturnType<typeof runtime.call>>()
      await Promise.all(Object.entries(queries).filter(([,sql])=>sql).map(async([stage,sql])=>{try{let pending=pendingSql.get(sql!);if(!pending){pending=runtime.call('query_data',{sql,datasource_name:s.datasource});pendingSql.set(sql!,pending)}const response=await pending;rows[stage]=parseRows(response.result);timings.push({...response.timing,stage})}catch(error){throw new LiveDiagnosticError('QUERY_EXECUTION_FAILED','query.'+stage,'queries.'+stage,'查询执行或结果解析失败：'+(error as Error).message,sql,'检查该阶段实际SQL和网关错误，勿修改无关图表配置')}}))
      for(const d of s.queries??[])if(!d.groupBy?.length&&rows[d.id].length!==1)throw Error('汇总查询必须返回一行：'+d.id)
      if (!s.queries && (rows.totals.length!==1 || (Number(rows.totals[0].records)===0 && !s.interactiveFilters?.length))) throw Error('当前筛选范围没有数据')
      for (const [key,group] of Object.entries(rows)) for (const row of group) for (let i=0;i<(s.queries?.find(d=>d.id===key)?.metrics??s.metrics).length;i++) if (row['m'+i]!==undefined && row['m'+i]!==null && !Number.isFinite(Number(row['m'+i]))) throw Error('指标返回值不是有效数值')
      if (!s.queries && s.dateField && rows.trend) s.metrics.forEach((m,i)=>{if (['sum','count'].includes(m.aggregate)) {const values=rows.trend.map(r=>r['m'+i]).filter(v=>v!==null);if(values.length && Math.abs(values.reduce((n,v)=>n+Number(v),0)-Number(rows.totals[0]['m'+i]))>Math.max(.01,Math.abs(Number(rows.totals[0]['m'+i]))*1e-10)) throw Error('趋势与汇总核对不一致，请重新刷新')}})
      const result={sqlProvenance:binding.plan?{...binding.plan,queries,fieldLabels:Object.fromEntries(schema.fields.map(f=>[f.name,f.description])),sqlKind:'executed'}:undefined,spec:s,appliedFilters:resolved.applied,results:rows,...rows,queriedAt:new Date().toISOString(),durationMs:Date.now()-started,timings,requestId:randomUUID(),validated:true}
      if(persist)await this.save('last-timing-'+id,{queriedAt:result.queriedAt,durationMs:result.durationMs,timings})
      return result
    })
  }
  async preflight(input:unknown,provenance?:unknown,html?:string) {
    const spec=validateSpec(input)
    if(provenance!==undefined)validateProvenance(provenance,html,spec,buildQueries(spec,'postgresql'))
    if(html!==undefined){validateProvenance(provenance,html,spec,buildQueries(spec,'postgresql'));bindLivePage(html,'preflight');await validateLiveRendering(html,spec)}
    const schema=await describe(spec.table,spec.datasource)
    if(!['postgresql','starrocks'].includes(schema.dialect))throw Error('不支持的数据源方言')
    checkSchema(spec,schema)
    const queries=buildQueries(applyInteractiveFilters(spec,undefined).spec,schema.dialect)
    return {valid:true,queryExecuted:false,dialect:schema.dialect,queries,queryAliases:spec.queries?.map(d=>({id:d.id,metrics:d.metrics.map((m,i)=>({alias:'m'+i,...m})),groups:(d.groupBy??[]).map((field,i)=>({alias:i?'d'+i:'bucket',field}))})),metricAliases:spec.metrics.map((m,i)=>({alias:'m'+i,field:m.field,aggregate:m.aggregate})),checked:{spec:true,authorizedSchema:true,provenance:provenance!==undefined,html:html!==undefined},nextAction:html===undefined?'先试运行查询，再生成页面与来源对应关系':'配置通过，可以保存；保存仍会执行真实查询验证'}
  }
  private planWriting: Promise<unknown> = Promise.resolve()
  async preparePlan(owner: string, input: unknown, provenance: unknown, html: string) {
    if (!owner) throw Error('计划必须属于原生会话')
    const checked = await this.preflight(input, provenance, html)
    const planId = randomUUID(), scope = fingerprint(await connection())
    await this.save('plan-'+planId, { owner, scope, spec: validateSpec(input), provenance, html, status: 'ready', createdAt: new Date().toISOString() })
    return { ...checked, planId, status: 'ready', nextAction: '完整预检通过，材料已保存。仅用 planId 和 assetId 调用 workbench_create_live_dashboard；不要重新输出 HTML。' }
  }
  private async readPlan(owner: string, planId: string) {
    if (!/^[a-f0-9-]{36}$/.test(planId)) throw Error('计划编号无效')
    const plan = await this.read<{owner:string;scope:string;spec:LiveSpec;provenance:unknown;html:string;status:string;assetId?:string;result?:Awaited<ReturnType<LiveService['create']>>}>('plan-'+planId)
    if (plan.owner !== owner || plan.scope !== fingerprint(await connection())) throw Error('计划不属于当前会话或数据授权已变更')
    return plan
  }
  async planStatus(owner: string, planId: string) {
    const plan = await this.readPlan(owner, planId)
    return { planId, status: plan.status, assetId: plan.assetId, result: plan.result, nextAction: plan.status === 'saved' ? '草稿已交付，请返回预览；不要重复生成。' : plan.status === 'saving' ? '上次保存结果不确定，禁止自动重建，请检查草稿与诊断。' : '材料已就绪，可用原计划编号继续保存。' }
  }
  async createFromPlan(owner: string, planId: string, assetId: string) {
    if (!/^[a-z][a-z0-9-]{2,62}$/.test(assetId)) throw Error('看板ID无效')
    const work = async () => {
      const plan = await this.readPlan(owner, planId)
      if (plan.assetId && plan.assetId !== assetId) throw Error('该计划已绑定其他看板，请重新预检')
      if (plan.status === 'saved' && plan.result) return { ...plan.result, planId, reused: true, deliveryStatus: 'saved' }
      if (plan.status === 'saving') throw Error('计划保存结果不确定，请检查原草稿；禁止重复创建')
      // Persist the attempt before side effects. An interrupted/failed save must
      // be reconciled, never blindly replayed into an extra revision.
      plan.status = 'saving'; plan.assetId = assetId
      await this.save('plan-'+planId, plan)
      const result = await this.create(assetId, plan.spec, plan.html, plan.provenance)
      plan.result = result; plan.status = 'saved'
      await this.save('plan-'+planId, plan)
      return { ...result, planId, reused: false, deliveryStatus: 'saved', nextAction: '该看板已保存并交付。停止对此计划的生成与保存，向用户展示预览；只有其他尚未完成的看板任务才继续。发布仍需用户确认。' }
    }
    const pending = this.planWriting.then(work)
    this.planWriting = pending.catch(() => {})
    return pending
  }
  async trial(input:unknown) {
    const preflight=await this.preflight(input),spec=validateSpec(input)
    const result=await this.executeBinding({id:randomUUID(),scope:fingerprint(await connection()),spec},false)
    const groups=result as unknown as Record<string,unknown>
    return {...preflight,nextAction:'查询通过。现在生成HTML与provenance，完整预检后保存；不必重复试查相同配置。',queryExecuted:true,validated:result.validated,durationMs:result.durationMs,timings:result.timings,queriedAt:result.queriedAt,results:Object.fromEntries(Object.keys(buildQueries(spec,'postgresql')).filter(k=>Array.isArray(groups[k])).map(k=>[k,{rowCount:(groups[k] as unknown[]).length,sample:(groups[k] as unknown[]).slice(0,3)}]))}
  }
  async diagnosticRun(operation:string,work:()=>Promise<unknown>) {
    const runId=randomUUID(),scope=fingerprint(await connection()),started=Date.now()
    try{const data=await work();await this.save('diagnostic-'+runId,{runId,scope,operation,ok:true,durationMs:Date.now()-started});return {ok:true,runId,data}}
    catch(error){const e=error as Error;const detail=error instanceof LiveDiagnosticError?{code:error.code,stage:error.stage,path:error.path,actual:error.actual,expected:error.expected,elementId:error.elementId}:{code:'VALIDATION_OR_SERVICE_ERROR',stage:operation,path:null};const result={ok:false,runId,operation,durationMs:Date.now()-started,error:{...detail,message:e.message},nextAction:'按stage/path修复后先预检；同类错误修复一次仍失败时读取本runId诊断，不猜日期转换或无关聚合。'};await this.save('diagnostic-'+runId,{...result,scope});return result}
  }
  async diagnostic(runId:string) {
    if(!/^[a-f0-9-]{36}$/.test(runId))throw Error('诊断ID无效')
    const value=await this.read<Record<string,unknown>>('diagnostic-'+runId)
    if(value.scope!==fingerprint(await connection()))throw Error('诊断授权已变更')
    const {scope,...result}=value;return result
  }
  async create(assetId: string, input: unknown, html?: string, provenance?: unknown) {
    const spec=validateSpec(input),id=randomUUID(),binding: Binding={id,scope:fingerprint(await connection()),spec}
    if(html!==undefined){const schema=await describe(spec.table,spec.datasource),queries=buildQueries(applyInteractiveFilters(spec,undefined).spec,schema.dialect);binding.plan={dialect:schema.dialect,queries,...validateProvenance(provenance,html,spec,queries)}}
    if(spec.queries && html===undefined)throw Error('多查询看板需要按模板生成HTML及来源对应关系')
    const page = html === undefined ? renderLive(spec.title,'/api/dsh-workbench/live/'+id+'/query') : bindLivePage(html,id)
    if(html!==undefined)await validateLiveRendering(html,spec)
    await this.save('binding-'+id,binding)
    const preview=await this.query(id)
    const task=async()=>{
      const stored=await this.library.buildAgentNativeDraft({assetId,title:spec.title,html:page,summary:'实时查询看板 · '+spec.table,sourceLabel:'实时 MCP · '+spec.datasource+' / '+spec.table})
      binding.assetId=assetId;binding.revision=stored.revision.revision
      if(binding.plan){const archive=join(this.root,'assets',assetId,'revisions',binding.revision,'queries');await mkdir(archive,{recursive:true});await writeFile(join(archive,'provenance.json'),JSON.stringify(binding.plan,null,2),{mode:0o600});for(const [stage,sql] of Object.entries(binding.plan.queries))if(sql)await writeFile(join(archive,stage+'.sql'),sql,{mode:0o600})}
    await this.save('binding-'+id,binding);await this.save('asset-'+assetId+'-'+binding.revision,binding)
      return {asset:stored.asset,revision:stored.revision,liveBindingId:id,preview:{durationMs:preview.durationMs,validated:preview.validated},previewUrl:`/dsh-workbench/assets/${assetId}/${binding.revision}/dashboard.html`,nextAction:'实时草稿已生成。请在工作台预览后明确发布；发布后可分享实时链接。'}
    }
    const next=this.writing.then(task);this.writing=next.then(()=>{},()=>{});return next
  }
  async createShare(assetId: string, days: number, base: string) {
    if (![1,7,30].includes(days)) throw Error('分享有效期为 1、7 或 30 天')
    const asset=await this.library.getAsset(assetId)
    if (!asset.releasedRevision) throw Error('请先在工作台发布看板')
    const binding=await this.find(assetId,asset.releasedRevision);if (!binding) throw Error('此版本不是实时看板')
    if (binding.scope!==fingerprint(await connection())) throw Error('数据源授权已变更')
    const token=randomBytes(24).toString('hex'),id=randomBytes(24).toString('hex'),hash=createHash('sha256').update(token).digest('hex')
    const share:Share={id,binding:binding.id,scope:binding.scope,assetId,revision:asset.releasedRevision,expiresAt:new Date(Date.now()+days*86400000).toISOString(),revoked:false,hash}
    await this.save('share-'+hash,share)
    return {token:id,url:base+'/s/'+token,expiresAt:share.expiresAt,revision:share.revision,status:'active',live:true}
  }
  async authorize(token: string): Promise<Share> {
    if (!/^[a-f0-9]{48}$/.test(token)) throw Error('分享链接无效')
    const share=await this.read<Share>('share-'+createHash('sha256').update(token).digest('hex'))
    if (share.revoked || Date.parse(share.expiresAt)<=Date.now() || share.scope!==fingerprint(await connection())) throw Error('分享链接已撤销或过期')
    const stored=await this.library.readRevision(share.assetId,share.revision)
    if(stored.revision.stage!=='released')throw Error('此版本未发布')
    return share
  }
  async shareState(assetId: string) {
    const asset=await this.library.getAsset(assetId),files=await readdir(join(this.root,'live')).catch(()=>[]),shares=[]
    for(const file of files.filter(f=>/^share-[a-f0-9]+\.json$/.test(f))){const value=await this.read<Share>(file.slice(0,-5));if(value.assetId===assetId)shares.push({token:value.id,revision:value.revision,expiresAt:value.expiresAt,status:value.revoked?'revoked':Date.parse(value.expiresAt)<=Date.now()?'expired':'active',url:'',live:true})}
    return {title:asset.displayName,revision:asset.releasedRevision||asset.latestRevision,isDraft:!asset.releasedRevision,lan:true,live:true,shares}
  }
  async revoke(assetId: string,id: unknown) {
    for(const file of await readdir(join(this.root,'live'))){if(!/^share-[a-f0-9]+\.json$/.test(file))continue;const share=await this.read<Share>(file.slice(0,-5));if(share.assetId===assetId&&share.id===id){await this.save(file.slice(0,-5),{...share,revoked:true});return {revoked:true}}}
    throw Error('分享链接不存在')
  }
}
