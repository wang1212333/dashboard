import type { LiveSpec } from './service.js'
export type Scalar=string|number|boolean
export type QueryFilter={field:string;op:'eq'|'gte'|'lte'|'lt'|'in'|'contains'|'startsWith'|'isNull'|'notNull';value:Scalar|Scalar[]}
export type InteractiveFilter={id:string;label:string;field:string;type:'select'|'multiSelect'|'dateRange'|'monthRange'|'numberRange'|'text'|'boolean'|'null';options?:Array<{label:string;value:Scalar}>;dynamic?:boolean;dependsOn?:string[];defaultValue?:any;min?:string|number;max?:string|number;storageFormat?:'date'|'timestamp'|'YYYY-MM-DD'|'YYYYMMDD'|'YYYYMM'|'YYYY-MM'|'YYYY-MM-01';utcOffset?:string;match?:'equals'|'contains'|'startsWith'}
const identifier=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(v)
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
const month=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v)
const scalar=(v:unknown):v is Scalar=>typeof v==='string'?v.length<=200&&!/[\x00-\x1f]/.test(v):typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)
export function validateInteractiveFilters(value:unknown):asserts value is InteractiveFilter[]|undefined{
 if(value===undefined)return
 if(!Array.isArray(value)||value.length>16)throw Error('交互筛选最多16项')
 const ids=new Set<string>()
 for(const f of value){
  if(!f||!identifier(f.id)||['__proto__','constructor','prototype'].includes(f.id)||!identifier(f.field)||typeof f.label!=='string'||!f.label.trim()||f.label.length>80||ids.has(f.id))throw Error('交互筛选ID、字段或名称无效或重复')
  ids.add(f.id)
  if(['select','multiSelect'].includes(f.type)){
   if(f.dynamic!==undefined&&typeof f.dynamic!=='boolean')throw Error('dynamic必须为布尔值')
   if(!f.dynamic&&(!Array.isArray(f.options)||!f.options.length))throw Error('静态选择需要已核实的选项；动态选择声明dynamic:true')
   if(f.options!==undefined&&(!Array.isArray(f.options)||f.options.length>500||f.options.some((o:any)=>!o||typeof o.label!=='string'||!o.label||o.label.length>200||!scalar(o.value))||new Set(f.options.map((o:any)=>JSON.stringify(o.value))).size!==f.options.length))throw Error('选项无效或超过500项')
   if(f.dynamic&&f.options?.length)throw Error('动态选项不能同时声明静态options')
  }else if(f.type==='dateRange'||f.type==='monthRange'){
   const valid=f.type==='dateRange'?date:month
   if(!valid(f.min)||!valid(f.max)||f.min>f.max)throw Error('时间筛选须声明有效的起止边界')
   if(f.type==='monthRange'&&!['YYYYMM','YYYY-MM','YYYY-MM-01'].includes(f.storageFormat))throw Error('月份范围须声明实际存储格式')
   if(f.type==='dateRange'&&f.storageFormat!==undefined&&!['date','timestamp','YYYY-MM-DD','YYYYMMDD'].includes(f.storageFormat))throw Error('日期存储格式无效')
   if(f.utcOffset!==undefined&&(!/^([+-])(?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(f.utcOffset)||f.storageFormat!=='timestamp'))throw Error('时间戳偏移无效')
  }else if(f.type==='numberRange'){
   if(f.min!==undefined&&!finite(f.min)||f.max!==undefined&&!finite(f.max)||f.min!==undefined&&f.max!==undefined&&f.min>f.max)throw Error('数值范围边界无效')
  }else if(f.type==='text'){
   if(f.match!==undefined&&!['equals','contains','startsWith'].includes(f.match))throw Error('文本匹配方式无效')
  }else if(!['boolean','null'].includes(f.type))throw Error('筛选类型无效')
  if(f.dependsOn!==undefined&&(!f.dynamic||!Array.isArray(f.dependsOn)||f.dependsOn.length>8||new Set(f.dependsOn).size!==f.dependsOn.length))throw Error('级联依赖仅用于动态选项，最多8项')
  normalizeValue(f,f.defaultValue)
 }
 const visited=new Set<string>(),visiting=new Set<string>()
 const visit=(id:string)=>{if(visiting.has(id))throw Error('筛选依赖存在循环');if(visited.has(id))return;visiting.add(id);const f=value.find(f=>f.id===id);if(!f)throw Error('筛选依赖不存在');for(const parent of f.dependsOn??[])visit(parent);visiting.delete(id);visited.add(id)}
 for(const f of value)visit(f.id)
}
function normalizeValue(f:InteractiveFilter,v:unknown):any{
 if(v===null||v===undefined||v===''&&f.type==='text')return null
 if(f.type==='select'||f.type==='multiSelect'){
  if(f.type==='multiSelect'&&(!Array.isArray(v)||v.length>50))throw Error('多选最多50项：'+f.id)
  const list=f.type==='multiSelect'?v as unknown[]:[v]
  if(list.some(x=>!scalar(x)||!f.dynamic&&!f.options?.some(o=>o.value===x)))throw Error('选择不在允许选项内：'+f.id)
  const normalized=[...new Map(list.map(x=>{const v=f.dynamic?String(x):x;return [JSON.stringify(v),v] as const})).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,x])=>x)
  return f.type==='select'?normalized[0]:normalized.length?normalized:null
 }
 if(f.type==='text'){if(typeof v!=='string'||!scalar(v))throw Error('文本筛选最多200字符');return v}
 if(f.type==='boolean'){if(typeof v!=='boolean')throw Error('布尔值无效');return v}
 if(f.type==='null'){if(!['empty','notEmpty'].includes(v as string))throw Error('空值筛选无效');return v}
 if(typeof v!=='object'||Array.isArray(v)||!v)throw Error('范围参数必须为对象：'+f.id)
 const range=v as Record<string,unknown>,keys=f.type==='numberRange'?['min','max']:['start','end']
 if(Object.keys(range).some(k=>!keys.includes(k)))throw Error('范围参数存在未知字段：'+f.id)
 if(f.type==='numberRange'){
  const min=range.min??f.min,max=range.max??f.max
  if(min!==undefined&&!finite(min)||max!==undefined&&!finite(max)||min!==undefined&&max!==undefined&&(min as number)>(max as number)||f.min!==undefined&&min!==undefined&&(min as number)<Number(f.min)||f.max!==undefined&&max!==undefined&&(max as number)>Number(f.max))throw Error('数值超出范围：'+f.id)
  return {min:min??null,max:max??null}
 }
 const valid=f.type==='dateRange'?date:month
 if(!valid(range.start)||!valid(range.end)||range.start>range.end||range.start<String(f.min)||range.end>String(f.max))throw Error('日期筛选超出允许范围或起止日期无效：'+f.id)
 return {start:range.start,end:range.end}
}
export function parseFilterParameters(raw:string|null):unknown{if(raw===null)return undefined;if(raw.length>64000)throw Error('筛选参数过长');return JSON.parse(raw)}
export function applyInteractiveFilters(spec:LiveSpec,input:unknown){
 const values=input===undefined?{}:input
 if(!values||typeof values!=='object'||Array.isArray(values))throw Error('筛选参数必须为对象')
 const defs=spec.interactiveFilters??[],provided=values as Record<string,unknown>
 if(Object.keys(provided).some(k=>!defs.some(f=>f.id===k)))throw Error('包含未开放的筛选条件')
 const filters:QueryFilter[]=[...(spec.filters??[])],applied:Record<string,unknown>={}
 for(const f of defs){
  const v=normalizeValue(f,Object.hasOwn(provided,f.id)?provided[f.id]:f.defaultValue);applied[f.id]=v
  const push=(op:QueryFilter['op'],value:QueryFilter['value'])=>filters.push({field:f.field,op,value})
  if(f.type==='dateRange'||f.type==='monthRange'){
   const range=v??{start:f.min,end:f.max},format=f.storageFormat??'date'
   const encode=(s:string)=>format==='YYYYMMDD'||format==='YYYYMM'?s.replaceAll('-',''):format==='YYYY-MM-01'?s+'-01':s
   if(format==='timestamp'){
    const next=new Date(Date.parse(range.end)+86400000).toISOString().slice(0,10)
    push('gte',range.start+' 00:00:00'+(f.utcOffset??''));push('lt',next+' 00:00:00'+(f.utcOffset??''))
   }else{push('gte',encode(range.start));push('lte',encode(range.end))}
  }else if(f.type==='numberRange'){
   const range=v??{min:f.min,max:f.max};if(range.min!=null)push('gte',range.min);if(range.max!=null)push('lte',range.max)
  }else if(v!==null){
   if(f.type==='multiSelect')push('in',v)
   else if(f.type==='text')push(f.match==='equals'?'eq':f.match??'contains',v)
   else if(f.type==='null')push(v==='empty'?'isNull':'notNull','')
   else push('eq',v)
  }
 }
 return {spec:{...spec,filters},applied}
}
export function filterSql(filters:QueryFilter[],dialect:string){
 const q=(s:string)=>dialect==='postgresql'?'"'+s+'"':'`'+s+'`'
 const literal=(v:Scalar)=>typeof v==='string'?"'"+v.replaceAll("'","''").replaceAll('\\',dialect==='starrocks'?'\\\\':'\\')+"'":String(v)
 return filters.map(f=>{
  if(!identifier(f.field))throw Error('无效查询字段')
  const field=q(f.field)
  if(f.op==='isNull'||f.op==='notNull')return field+(f.op==='isNull'?' IS NULL':' IS NOT NULL')
  if(f.op==='in'){if(!Array.isArray(f.value)||!f.value.length)throw Error('IN列表为空');return field+' IN ('+f.value.map(literal).join(', ')+')'}
  if(Array.isArray(f.value))throw Error('无效标量')
  if(f.op==='contains'||f.op==='startsWith')return (dialect==='postgresql'?'STRPOS':'INSTR')+'('+field+', '+literal(f.value)+')'+(f.op==='contains'?' > 0':' = 1')
  const op={eq:'=',gte:'>=',lte:'<=',lt:'<'}[f.op];if(!op)throw Error('无效操作符')
  return field+' '+op+' '+literal(f.value)
 }).join(' AND ')
}
