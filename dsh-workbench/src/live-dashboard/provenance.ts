import { LiveDiagnosticError } from './diagnostics.js'
import type { LiveSpec } from './service.js'
export type Provenance = { elements: Array<{ id: string; title: string; query: string; fields: string[]; processing: string }> }
export function validateProvenance(input: unknown, html: string | undefined, spec: LiveSpec, queries: Record<string,string|undefined>): Provenance {
 const p=input as Provenance
 if(!p || !Array.isArray(p.elements) || !p.elements.length || p.elements.length>128)throw Error('新实时看板必须提供 provenance.elements 图表与 SQL 对应关系')
 const markup=(html ?? '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'')
 const markers=[...markup.matchAll(/data-sql-source\s*=\s*["']([^"']+)["']/g)].map(m=>m[1]),ids=new Set<string>(),covered=new Set<string>()
 for(const [index,e] of p.elements.entries()){
  const path='provenance.elements['+index+']';
  const fail=(code:string,field:string,message:string,actual:unknown,expected:unknown):never=>{throw new LiveDiagnosticError(code,'provenance',path+'.'+field,message,actual,expected,e?.id)}
  if(!e || !/^[a-z][a-z0-9-]{0,63}$/.test(e.id) || ids.has(e.id) || typeof e.title!=='string' || !e.title.trim() || e.title.length>160 || typeof e.processing!=='string' || !e.processing.trim() || e.processing.length>2000)throw Error('SQL 对应关系的标识、标题或计算说明无效')
  ids.add(e.id)
  if(!Object.hasOwn(queries,e.query) || !queries[e.query])fail('INVALID_QUERY_STAGE','query','查询阶段无效；这是来源映射校验，尚未执行数据查询',e.query,Object.keys(queries).filter(k=>queries[k]));
  if(!Array.isArray(e.fields) || !e.fields.length || e.fields.length>10)fail('INVALID_SOURCE_FIELDS','fields','字段必须是包含1–10个返回字段别名的数组，尚未执行数据查询',e.fields,'例如 [\"m0\"]，不是物理列名')
  const definition=spec.queries?.find(d=>d.id===e.query)
  const allowed=new Set((definition?.metrics??spec.metrics).map((m,i)=>e.query==='trend'&&m.aggregate==='latest_sum'?'':'m'+i))
  if(definition){allowed.add('records');if(definition.dateField)allowed.add('data_date');(definition.groupBy??[]).forEach((_,i)=>allowed.add(i?'d'+i:'bucket'))}
  else if(e.query==='totals'){allowed.add('records');if(spec.dateField)allowed.add('data_date')}else allowed.add('bucket')
  for(const f of e.fields){if(!f || !allowed.has(f))fail('UNKNOWN_SOURCE_FIELD','fields','SQL 对应字段不存在：'+f+'；请同步指标索引，尚未执行数据查询',f,[...allowed].filter(Boolean));covered.add(definition?e.query+':'+f:f)}
  if(html!==undefined && !markers.includes(e.id))throw Error('页面缺少 data-sql-source="'+e.id+'"')
 }
 if(markers.some(id=>!ids.has(id)))throw Error('页面存在未定义的 SQL 对应关系')
 if(spec.queries?.some(d=>d.metrics.some((_,i)=>!covered.has(d.id+':m'+i))))throw Error('每组查询的每个业务指标必须具备 SQL 对应关系')
 if(!spec.queries && spec.metrics.some((_,i)=>!covered.has('m'+i)))throw Error('每个业务指标必须具备 SQL 对应关系')
 return JSON.parse(JSON.stringify(p)) as Provenance
}
