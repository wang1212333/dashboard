import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FilesystemKnowledgeLibrary } from '../src/library/filesystem-library.js'
import { buildQueries, LiveService, validateSpec, type LiveSpec } from '../src/live-dashboard/service.js'
import * as mcp from '../src/live-dashboard/mcp.js'
import { bindLivePage, validateLiveScripts } from '../src/live-dashboard/page.js'
import { startLiveShareServer } from '../src/live-dashboard/sharing.js'
import { validateProvenance } from '../src/live-dashboard/provenance.js'
vi.mock('../src/live-dashboard/mcp.js',async()=>{
 const actual=await vi.importActual<typeof import('../src/live-dashboard/mcp.js')>('../src/live-dashboard/mcp.js')
 return {...actual,connection:vi.fn(async()=>({url:'https://example.test',token:'test'})),describe:vi.fn(async()=>({dialect:'postgresql',fields:[{name:'day',type:'date'},{name:'amount',type:'numeric'},{name:'country',type:'varchar'}]})),runtime:{coalesce:async(_k:string,fn:()=>unknown)=>fn(),call:vi.fn(async(_n:string,a:any)=>({timing:{},result:{content:[{type:'text',text:a.sql.includes('GROUP BY')?'返回行数: 1\nbucket | m0\n--------------------\n2026-09-01 | 10':'返回行数: 1\nm0 | records | data_date\n--------------------\n10 | 1 | 2026-09-01'}]}}))}}
})
const spec:LiveSpec={title:'测试',table:'demo.sales',datasource:'demo',metrics:[{field:'amount',aggregate:'sum',label:'金额',definition:'期间金额'}],dateField:'day',refreshSeconds:300}
const roots:string[]=[]
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});vi.mocked(mcp.connection).mockResolvedValue({url:'https://example.test',token:'test'})})
async function setup(){const r=await mkdtemp(join(tmpdir(),'live-check-'));roots.push(r);const lib=new FilesystemKnowledgeLibrary(r);return {lib,live:new LiveService(r,lib)}}
it('rejects executable identifiers and invalid snapshot definitions',()=>{expect(()=>validateSpec({...spec,table:'demo.sales;DELETE'})).toThrow();expect(()=>validateSpec({...spec,metrics:[{...spec.metrics[0],field:'sum(amount)'}]})).toThrow();expect(()=>validateSpec({...spec,dateField:undefined,metrics:[{...spec.metrics[0],aggregate:'latest_sum'}]})).toThrow()})
it('escapes filter values and constrains snapshots to last date',()=>{expect(buildQueries({...spec,filters:[{field:'country',op:'eq',value:"x' OR 1=1 --"}]},'postgresql').totals).toContain("'x'' OR 1=1 --'");const q=buildQueries({...spec,metrics:[{...spec.metrics[0],aggregate:'latest_sum'}]},'starrocks');expect(q.totals).toContain('SELECT MAX(`day`)');expect(q.trend).toBeUndefined()})
it('validates discovered fields',async()=>{const {live}=await setup();await expect(live.create('invalid-live',{...spec,dimension:'unknown'})).rejects.toThrow('字段')})
it('requires publication and persists then revokes fixed-version shares',async()=>{const {live,lib}=await setup(),draft=await live.create('valid-live',spec);await expect(live.createShare('valid-live',1,'http://localhost')).rejects.toThrow('发布');await lib.preview('valid-live',draft.revision.revision);await lib.release('valid-live',draft.revision.revision,{approvalId:'test-user'});const link=await live.createShare('valid-live',1,'http://localhost'),token=link.url.split('/s/')[1],restarted=new LiveService(live.root,lib);expect((await restarted.authorize(token)).assetId).toBe('valid-live');await restarted.revoke('valid-live',link.token);await expect(live.authorize(token)).rejects.toThrow('撤销')})
it('invalidates queries after permission identity changes',async()=>{const {live}=await setup(),draft=await live.create('scope-live',spec);vi.mocked(mcp.connection).mockResolvedValue({url:'https://example.test',token:'changed'});await expect(live.query(draft.liveBindingId)).rejects.toThrow('授权已变更')})
it('preserves null and rejects incomplete results',()=>{expect(mcp.parseRows({content:[{type:'text',text:'返回行数: 1\nm0\n--------------------\nnull'}]})).toEqual([{m0:null}]);expect(()=>mcp.parseRows({content:[{type:'text',text:'返回行数: 2\nm0\n--------------------\n1'}]})).toThrow('不完整')})

const designedPage = '<html><head><style>body{background:#102030}</style></head><body><h1 data-sql-source="total">Selected design</h1><p id="dsh-live-status"></p><button id="dsh-live-refresh">Refresh</button><script>window.renderDSHLive = data => { document.querySelector("h1").textContent=data.spec.title }</script></body></html>'
it('rejects malformed animation scripts without executing generated code',()=>{
 expect(()=>bindLivePage(designedPage.replace('window.renderDSHLive',"const broken = `animation-delay:${i*.02+s`; window.renderDSHLive"),'id')).toThrow('语法错误')
 expect(()=>validateLiveScripts('<script>throw Error("must not execute")</script><script type="application/json">{"key":1}</script>')).not.toThrow()
})
it('rejects pages missing the refresh contract',()=>{
 expect(()=>bindLivePage('<html><body>static</body></html>','id')).toThrow('实时页面')
 expect(()=>bindLivePage(bindLivePage(designedPage,'id'),'id')).toThrow('重复')
})
const provenance={elements:[{id:'total',title:'金额',query:'totals',fields:['m0'],processing:'直接展示汇总金额'}]}
it('requires complete valid SQL mappings for new generated pages',async()=>{
 const q=buildQueries(spec,'postgresql'),check=(p:unknown,h=designedPage)=>validateProvenance(p,h,spec,q)
 expect(()=>check(undefined)).toThrow('provenance')
 expect(()=>check(provenance)).not.toThrow()
 expect(()=>check({elements:[{...provenance.elements[0],fields:['m9']}]})).toThrow('字段')
 expect(()=>check({elements:[{...provenance.elements[0],query:'ranking'}]})).toThrow('阶段')
 expect(()=>check({elements:[{...provenance.elements[0],fields:['records']}]})).toThrow('每个业务指标')
 expect(()=>check(provenance,designedPage.replace('data-sql-source','data-other'))).toThrow('缺少')
 expect(()=>check({elements:[...provenance.elements,...provenance.elements]})).toThrow('标识')
 const {live}=await setup();await expect(live.create('missing-map',spec,designedPage)).rejects.toThrow('provenance')
})
it('serves the exact published design and pins it when a newer draft exists',async()=>{
 const {live,lib}=await setup(),draft=await live.create('designed-live',spec,designedPage,provenance)
 await lib.preview('designed-live',draft.revision.revision)
 await lib.release('designed-live',draft.revision.revision,{approvalId:'test-user'})
 const published=await lib.readRevision('designed-live',draft.revision.revision)
 await live.create('designed-live',spec,designedPage.replace('Selected design','New draft design'),provenance)
 vi.stubEnv('DSH_LIVE_SHARE_PORT','0');vi.stubEnv('DSH_LIVE_SHARE_HOST','127.0.0.1')
 const server=startLiveShareServer(live)
 try{
  await new Promise<void>(resolve=>server.listening?resolve():server.once('listening',resolve))
  const address=server.address() as {port:number},link=await live.createShare('designed-live',1,'http://127.0.0.1:'+address.port)
  const response=await fetch(link.url)
  expect(response.status).toBe(200);expect(await response.text()).toBe(published.html)
  const shared=await (await fetch(link.url+'/query')).json();expect(shared.validated).toBe(true);expect(shared.sqlProvenance).toBeUndefined();const owner=await live.query(draft.liveBindingId);expect(owner.sqlProvenance?.queries.totals).toBe(buildQueries(spec,'postgresql').totals)
  await live.revoke('designed-live',link.token);expect((await fetch(link.url)).status).toBe(403)
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));vi.unstubAllEnvs()}
})

it('preflight locates source errors without executing queries and diagnosis survives restart',async()=>{
 const {live,lib}=await setup();vi.mocked(mcp.runtime.call).mockClear()
 const result=await live.diagnosticRun('preflight',()=>live.preflight(spec,{elements:[{...provenance.elements[0],query:'totals|trend|ranking'}]}))
 expect(result.ok).toBe(false);expect(mcp.runtime.call).not.toHaveBeenCalled()
 const report=await new LiveService(live.root,lib).diagnostic(result.runId)
 expect(report.error).toMatchObject({code:'INVALID_QUERY_STAGE',stage:'provenance',path:'provenance.elements[0].query',expected:['totals','trend']})
 vi.mocked(mcp.connection).mockResolvedValue({url:'https://example.test',token:'changed'})
 await expect(live.diagnostic(result.runId)).rejects.toThrow('授权')
})
it('trial executes exactly preflight SQL and returns bounded samples without saving assets',async()=>{
 const {live}=await setup();vi.mocked(mcp.runtime.call).mockClear()
 const preflight=await live.preflight(spec);expect(mcp.runtime.call).not.toHaveBeenCalled()
 const trial=await live.trial(spec);expect(trial.queryExecuted).toBe(true);expect(trial.results.totals.sample).toHaveLength(1)
 expect(vi.mocked(mcp.runtime.call).mock.calls.map(c=>(c[1] as any).sql).sort()).toEqual(Object.values(preflight.queries).filter(Boolean).sort())
 expect(trial.queries.trend).not.toMatch(/to_char|date_trunc|::date/)
})
it('reports exact failing query stage instead of blaming provenance',async()=>{
 const {live}=await setup();vi.mocked(mcp.runtime.call).mockRejectedValueOnce(Error('test gateway failure'))
 const result=await live.diagnosticRun('trial',()=>live.trial(spec));expect(result.ok).toBe(false)
 const report=await live.diagnostic(result.runId);expect(report.error).toMatchObject({code:'QUERY_EXECUTION_FAILED',stage:'query.totals',path:'queries.totals'})
})
it('parses blank comments and multiword SQL types without skipping adjacent fields',()=>{
 expect(mcp.parseSchemaFields('first text YES    \nsecond double precision YES    重量\nthird bigint NO')).toEqual([{name:'first',type:'text',description:''},{name:'second',type:'double precision',description:'重量'},{name:'third',type:'bigint',description:''}])
})
it('persists an owned plan and reuses its saved result across retries and restart',async()=>{
 const {live,lib}=await setup()
 vi.spyOn(live,'preflight').mockResolvedValue({valid:true} as never)
 const plan=await live.preparePlan('session-a',spec,{elements:[]},'<html>test</html>')
 const result=await live.create('plan-draft',spec)
 const create=vi.spyOn(live,'create').mockResolvedValue(result)
 const [a,b]=await Promise.all([live.createFromPlan('session-a',plan.planId,'plan-draft'),live.createFromPlan('session-a',plan.planId,'plan-draft')])
 expect(create).toHaveBeenCalledTimes(1)
 expect(a.reused).toBe(false);expect(b.reused).toBe(true)
 const restarted=new LiveService(live.root,lib)
 expect((await restarted.createFromPlan('session-a',plan.planId,'plan-draft')).revision.revision).toBe(result.revision.revision)
 await expect(restarted.createFromPlan('session-b',plan.planId,'plan-draft')).rejects.toThrow('会话')
 await expect(restarted.createFromPlan('session-a',plan.planId,'different-draft')).rejects.toThrow('其他看板')
 expect((await restarted.planStatus('session-a',plan.planId)).status).toBe('saved')
 vi.mocked(mcp.connection).mockResolvedValue({url:'https://example.test',token:'changed'})
 await expect(restarted.planStatus('session-a',plan.planId)).rejects.toThrow('授权')
})
it('does not duplicate a potentially committed plan after an interrupted save',async()=>{
 const {live}=await setup()
 vi.spyOn(live,'preflight').mockResolvedValue({valid:true} as never)
 const plan=await live.preparePlan('s',spec,{},'html')
 const create=vi.spyOn(live,'create').mockRejectedValue(new Error('disk failure'))
 await expect(live.createFromPlan('s',plan.planId,'test-plan')).rejects.toThrow('disk failure')
 await expect(live.createFromPlan('s',plan.planId,'test-plan')).rejects.toThrow('不确定')
 expect(create).toHaveBeenCalledTimes(1)
 expect((await live.planStatus('s',plan.planId)).status).toBe('saving')
})
import {applyInteractiveFilters,parseFilterParameters} from '../src/live-dashboard/filters.js'
const interactive:LiveSpec={...spec,filters:[{field:'amount',op:'gte',value:0}],interactiveFilters:[{id:'country',label:'国家',field:'country',type:'select',options:[{label:'甲',value:'A'},{label:'乙',value:"B'"}],defaultValue:'A'},{id:'date',label:'日期',field:'day',type:'dateRange',min:'2026-01-01',max:'2026-12-31'}]}
it('preserves fixed bounds and escapes runtime values in every query',()=>{
 const result=applyInteractiveFilters(interactive,{country:"B'",date:{start:'2026-09-01',end:'2026-09-14'}})
 const sql=buildQueries({...result.spec,dimension:'country'},'postgresql')
 for(const text of Object.values(sql)){expect(text).toContain('"amount" >= 0');expect(text).toContain("'B''' ");expect(text).toContain("'2026-09-14'")}
 expect(interactive.filters).toHaveLength(1)
})
it('rejects undeclared, out of range, malformed and non-whitelisted filter inputs',()=>{
 for(const value of [{other:'A'},{country:'injected'},{date:{start:'2026-09-31',end:'2026-10-01'}},{date:{start:'2025-01-01',end:'2026-09-01'}},{date:{start:'2026-09-14',end:'2026-09-01'}},[]])expect(()=>applyInteractiveFilters(interactive,value)).toThrow()
 expect(()=>parseFilterParameters('x'.repeat(64001))).toThrow()
 expect(()=>validateSpec({...interactive,interactiveFilters:[interactive.interactiveFilters![0],interactive.interactiveFilters![0]]})).toThrow()
})
it('defaults and clearing remain within the fixed scope',()=>{
 expect(applyInteractiveFilters(interactive,undefined).applied.country).toBe('A')
 expect(applyInteractiveFilters(interactive,{country:null,date:null}).spec.filters).toEqual([...interactive.filters!,{field:'day',op:'gte',value:'2026-01-01'},{field:'day',op:'lte',value:'2026-12-31'}])
})
it('executes selected values and returns matching SQL without changing saved defaults',async()=>{
 const {live}=await setup(),draft=await live.create('filter-live',interactive,designedPage,provenance)
 const selected=await live.query(draft.liveBindingId,{country:"B'"})
 expect(selected.sqlProvenance?.queries.totals).toContain("'B'''")
 expect(selected.appliedFilters.country).toBe("B'")
 expect((await live.query(draft.liveBindingId)).appliedFilters.country).toBe('A')
 const count=vi.mocked(mcp.runtime.call).mock.calls.length
 await expect(live.query(draft.liveBindingId,{country:'unapproved'})).rejects.toThrow()
 expect(vi.mocked(mcp.runtime.call).mock.calls.length).toBe(count)
})
it('shares accept whitelisted filters, hide SQL and reject unknown values',async()=>{
 const {live,lib}=await setup(),draft=await live.create('filter-share',interactive,designedPage,provenance)
 await lib.preview('filter-share',draft.revision.revision);await lib.release('filter-share',draft.revision.revision,{approvalId:'test-user'})
 vi.stubEnv('DSH_LIVE_SHARE_PORT','0');vi.stubEnv('DSH_LIVE_SHARE_HOST','127.0.0.1');const server=startLiveShareServer(live)
 try{
  await new Promise<void>(r=>server.listening?r():server.once('listening',r));const address=server.address() as {port:number}
  const link=await live.createShare('filter-share',1,'http://127.0.0.1:'+address.port)
  const response=await fetch(link.url+'/query?filters='+encodeURIComponent(JSON.stringify({country:"B'"})))
  expect(response.status).toBe(200);const data=await response.json();expect(data.appliedFilters.country).toBe("B'");expect(data.sqlProvenance).toBeUndefined()
  expect((await fetch(link.url+'/query?filters='+encodeURIComponent('{"country":"unapproved"}'))).status).toBe(403)
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllEnvs()}
},20000)
it('dynamic options query original scoped data with parent predicates and bounded pagination',async()=>{
 const {live}=await setup(),s:LiveSpec={...spec,filters:[{field:'amount',op:'gte',value:0}],interactiveFilters:[{id:'period',label:'日期',field:'day',type:'dateRange',min:'2026-01-01',max:'2026-12-31'},{id:'country',label:'国家',field:'country',type:'multiSelect',dynamic:true,dependsOn:['period']}]}
 const draft=await live.create('dynamic-options',s,designedPage,provenance),call=vi.mocked(mcp.runtime.call),previous=call.getMockImplementation()!;let optionSQL=''
 call.mockImplementation(async(n,a:any)=>{if(a.sql.includes('options_source')){optionSQL=a.sql;return {timing:{},result:{content:[{type:'text',text:'返回行数: 51\noption_hex\n--------------------\n'+Array.from({length:51},(_,i)=>'v'+Buffer.from('Country'+i).toString('hex')).join('\n')}]}}}return previous(n,a)})
 try{
  const r=await live.options(draft.liveBindingId,'country',{period:{start:'2026-09-01',end:'2026-09-14'},country:['old']},'C',50)
  expect(r.options).toHaveLength(50);expect(r.nextCursor).toBe(100);expect(optionSQL).toContain('SELECT DISTINCT');expect(optionSQL).toContain('LIMIT 51 OFFSET 50');expect(optionSQL).toContain('"amount" >= 0');expect(optionSQL).toContain("'2026-09-14'");expect(optionSQL).not.toContain("'old'")
  await expect(live.options(draft.liveBindingId,'undeclared',{})).rejects.toThrow();await expect(live.options(draft.liveBindingId,'country',{},'',-1)).rejects.toThrow()
  const count=call.mock.calls.length;vi.mocked(mcp.connection).mockResolvedValue({url:'https://example.test',token:'changed'});await expect(live.options(draft.liveBindingId,'country',{})).rejects.toThrow('授权');expect(call.mock.calls.length).toBe(count)
 }finally{call.mockImplementation(previous)}
},30000)
it('POST share requests retain runtime filters and reject query injection and revoked access',async()=>{
 const {live,lib}=await setup(),draft=await live.create('post-share',interactive,designedPage,provenance)
 await lib.preview('post-share',draft.revision.revision);await lib.release('post-share',draft.revision.revision,{approvalId:'test-user'})
 vi.stubEnv('DSH_LIVE_SHARE_PORT','0');vi.stubEnv('DSH_LIVE_SHARE_HOST','127.0.0.1');const server=startLiveShareServer(live)
 try{await new Promise<void>(r=>server.listening?r():server.once('listening',r));const link=await live.createShare('post-share',1,'http://127.0.0.1:'+(server.address() as {port:number}).port)
 const post=(body:unknown)=>fetch(link.url+'/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 const response=await post({filters:{country:"B'"}}),data=await response.json();expect(response.status).toBe(200);expect(data.appliedFilters.country).toBe("B'");expect(data.sqlProvenance).toBeUndefined()
 expect((await post({sql:'SELECT * FROM secret'})).status).toBe(403)
 await live.revoke('post-share',link.token);expect((await post({filters:{}})).status).toBe(403)
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllEnvs()}
},30000)
it('recognizes explicitly empty gateway results without a table header',()=>{
 expect(mcp.parseRows({content:[{type:'text',text:'SQL: SELECT x\n返回行数: 0  耗时: 32ms\n\n'}]})).toEqual([])
 expect(()=>mcp.parseRows({content:[{type:'text',text:'无结果但没有明确行数'}]})).toThrow()
 expect(()=>mcp.parseRows({content:[{type:'text',text:'返回行数: 0\nm0\n--------------------\n1'}]})).toThrow()
})

it('runs independent query groups with shared filters and query-scoped provenance',async()=>{
 const multi={...spec,queries:[{id:'q_total',metrics:spec.metrics},{id:'q_country',metrics:spec.metrics,groupBy:['country']},{id:'q_day',metrics:spec.metrics,groupBy:['day'],orderBy:{field:'bucket',direction:'asc' as const}}],interactiveFilters:[{id:'country',field:'country',label:'国家',type:'text' as const}]}
 const sql=buildQueries(validateSpec(multi),'postgresql');expect(Object.keys(sql)).toEqual(['q_total','q_country','q_day']);expect(sql.q_day).toContain('ORDER BY "bucket" ASC');expect(sql.q_country).toContain('GROUP BY "country"')
 const provenance={elements:multi.queries.map((d,i)=>({id:'element-'+i,title:d.id,query:d.id,fields:['m0'],processing:'直接展示'}))}
 expect(()=>validateProvenance({elements:provenance.elements.slice(0,1)},undefined,multi,sql)).toThrow('每组查询')
 const html=designedPage.replace('data-sql-source="total"','data-sql-source="element-0"').replace('</body>','<div data-sql-source="element-1"></div><div data-sql-source="element-2"></div></body>')
 const {live,lib}=await setup(),draft=await live.create('multi-query-test',multi,html,provenance)
 const result=await live.query(draft.liveBindingId,{country:"A'B"});expect(Object.keys(result.results)).toEqual(expect.arrayContaining(['q_total','q_country','q_day']))
 for(const q of Object.values(result.sqlProvenance!.queries))expect(q).toContain("A''B")
 await lib.preview('multi-query-test',draft.revision.revision);await lib.release('multi-query-test',draft.revision.revision,{approvalId:'test-user'})
 const share=await live.createShare('multi-query-test',1,'http://localhost'),token=share.url.split('/s/')[1];expect((await live.authorize(token)).binding).toBe(draft.liveBindingId)
 await live.revoke('multi-query-test',share.token);await expect(live.authorize(token)).rejects.toThrow('撤销')
 expect(()=>validateSpec({...multi,queries:[{...multi.queries[0],id:'__proto__'}]})).toThrow()
 expect(()=>validateSpec({...multi,queries:[{...multi.queries[1],orderBy:{field:'DROP TABLE',direction:'asc'}}]})).toThrow()
 await expect(live.preflight({...multi,queries:[{...multi.queries[1],groupBy:['secret']}]})).rejects.toThrow('未授权')
})
it('supports sixteen query IDs while merging identical SQL inside one refresh',async()=>{
 const {live}=await setup();const multi={...spec,queries:Array.from({length:16},(_,i)=>({id:'q_item_'+i,metrics:spec.metrics}))};
 vi.mocked(mcp.runtime.call).mockClear();const result=await live.trial(multi);expect(Object.keys(result.results)).toHaveLength(16);expect(vi.mocked(mcp.runtime.call)).toHaveBeenCalledTimes(1)
})
