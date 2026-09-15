import {expect,it} from 'vitest'
import {applyInteractiveFilters,filterSql,validateInteractiveFilters,type InteractiveFilter} from '../src/live-dashboard/filters.js'
import {buildQueries,type LiveSpec} from '../src/live-dashboard/service.js'
const base:LiveSpec={title:'通用',table:'demo.sales',datasource:'demo',metrics:[{field:'amount',aggregate:'sum',label:'值',definition:'测试'}],refreshSeconds:60,filters:[{field:'tenant',op:'eq',value:'fixed'}]}
const resolve=(f:InteractiveFilter,v:unknown)=>applyInteractiveFilters({...base,interactiveFilters:[f]},{[f.id]:v})
it('supports each field-specific type while preserving the fixed authorization scope',()=>{
 const defs:InteractiveFilter[]=[{id:'a',field:'country',label:'国家',type:'multiSelect',dynamic:true},{id:'b',field:'amount',label:'金额',type:'numberRange',min:0,max:100},{id:'c',field:'name',label:'名称',type:'text',match:'contains'},{id:'d',field:'active',label:'有效',type:'boolean'},{id:'e',field:'missing',label:'空值',type:'null'}]
 validateInteractiveFilters(defs)
 const r=applyInteractiveFilters({...base,interactiveFilters:defs},{a:['B',"A'",'B'],b:{min:3,max:9},c:'50%_!',d:false,e:'empty'})
 for(const dialect of ['postgresql','starrocks']){const sql=buildQueries(r.spec,dialect).totals;expect(sql).toContain("'fixed'");expect(sql).toContain("IN ('A''', 'B')");expect(sql).toContain('>= 3');expect(sql).toContain('<= 9');expect(sql).toContain("'50%_!'");expect(sql).toContain('= false');expect(sql).toContain('IS NULL')}
 expect(r.applied.a).toEqual(["A'",'B']);expect(base.filters).toHaveLength(1)
})
it('supports verified month encodings without casting source fields',()=>{
 for(const [storageFormat,expected] of [['YYYYMM','202609'],['YYYY-MM','2026-09'],['YYYY-MM-01','2026-09-01']] as const){
  const r=resolve({id:'period',label:'月份',field:'part_ym',type:'monthRange',storageFormat,min:'2026-01',max:'2026-12'},{start:'2026-09',end:'2026-09'})
  expect(filterSql(r.spec.filters!,'postgresql')).toContain("'"+expected+"'")
 }
})
it('covers entire timestamp end day and preserves boundaries when cleared',()=>{
 const f:InteractiveFilter={id:'period',label:'日期',field:'created',type:'dateRange',storageFormat:'timestamp',utcOffset:'+08:00',min:'2026-01-01',max:'2026-12-31'}
 validateInteractiveFilters([f]);const sql=filterSql(resolve(f,{start:'2026-09-01',end:'2026-09-14'}).spec.filters!,'postgresql')
 expect(sql).toContain(">= '2026-09-01 00:00:00+08:00'");expect(sql).toContain("< '2026-09-15 00:00:00+08:00'")
 expect(filterSql(resolve(f,null).spec.filters!,'postgresql')).toContain("< '2027-01-01 00:00:00+08:00'")
})
it('accepts compact dates and rejects invalid calendar days and partial ranges',()=>{
 const f:InteractiveFilter={id:'date',label:'日期',field:'day',type:'dateRange',storageFormat:'YYYYMMDD',min:'2026-01-01',max:'2026-12-31'}
 expect(filterSql(resolve(f,{start:'2026-09-01',end:'2026-09-14'}).spec.filters!,'starrocks')).toContain("'20260914'")
 for(const value of [{start:'2026-02-30',end:'2026-03-01'},{start:'2026-09-01'},{start:'2025-01-01',end:'2026-09-14'}])expect(()=>resolve(f,value)).toThrow()
})
it('rejects cycles, unknown parents, unsafe IDs and excessive field definitions',()=>{
 const a:InteractiveFilter={id:'a',label:'a',field:'a',type:'select',dynamic:true,dependsOn:['b']},b:InteractiveFilter={...a,id:'b',field:'b',dependsOn:['a']}
 expect(()=>validateInteractiveFilters([a,b])).toThrow('循环');expect(()=>validateInteractiveFilters([a])).toThrow('不存在');expect(()=>validateInteractiveFilters([{...a,id:'__proto__'}])).toThrow()
 expect(()=>validateInteractiveFilters(Array.from({length:17},(_,i)=>({...a,id:'f'+i,dependsOn:[]})))).toThrow()
 validateInteractiveFilters(Array.from({length:16},(_,i)=>({...a,id:'f'+i,dependsOn:[]})))
})
it('normalizes multisets and rejects over-limit or malformed runtime values',()=>{
 const f:InteractiveFilter={id:'a',label:'a',field:'a',type:'multiSelect',dynamic:true}
 expect(resolve(f,['b','a','a']).applied).toEqual(resolve(f,['a','b']).applied)
 for(const v of ['a',[{}],Array.from({length:51},(_,i)=>String(i)),['x\0y']])expect(()=>resolve(f,v)).toThrow()
 expect(()=>resolve({id:'n',label:'n',field:'n',type:'numberRange',min:0},{min:-1})).toThrow()
 expect(()=>resolve({id:'b',label:'b',field:'b',type:'boolean'},'false')).toThrow()
})
it('treats wildcard characters as literal text and escapes quote/backslash by dialect',()=>{
 const f:InteractiveFilter={id:'t',label:'t',field:'name',type:'text',match:'startsWith'}
 expect(filterSql(resolve(f,"a'%_\\").spec.filters!,'starrocks')).toContain("INSTR(`name`, 'a''%_\\\\') = 1")
 expect(filterSql(resolve(f,'x').spec.filters!,'postgresql')).toContain("STRPOS(\"name\", 'x') = 1")
})
