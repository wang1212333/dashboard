export class LiveDiagnosticError extends Error {
 constructor(readonly code:string,readonly stage:string,readonly path:string,message:string,readonly actual?:unknown,readonly expected?:unknown,readonly elementId?:string){super(message)}
}
export const liveCapabilities={
 version:4, dialects:['postgresql','starrocks'],maxMetrics:6,maxFilters:8,maxRankingDimensions:16,maxQueries:16,maxGroupFieldsPerQuery:3,
 queryBehavior:'新看板默认使用spec.queries，每组{id:q_业务标识,metrics,groupBy?,dateField?,orderBy?:{field:m0或bucket或d1,direction:asc或desc},limit?}。共用spec的数据源、表和全部固定/交互筛选。页面从data.results[查询ID]读取，provenance.query填写该ID。分组别名bucket、d1、d2；指标每组独立从m0起。最多16组、每组6指标、3分组，limit最大5000，默认20。无groupBy表示汇总。旧totals/trend/ranking仅用于兼容旧看板。',
 queryStages:['totals','trend','ranking'],rankingLimit:20,trendLimit:5000,
 aggregates:['sum','avg','min','max','count','count_distinct','latest_sum'],filterOperators:['eq','gte','lte'],refreshSeconds:[60,300,900,3600],
 dateBehavior:'按原字段值分组和排序，不使用 to_char/date_trunc/强制日期转换；YYYYMM 文本可直接分组，不自动把日数据转月数据。',
 unsupported:['明细分页与下钻','任意SQL或多表关联','专用同比环比查询'],
 filterBehavior:'按每个数据集的授权字段和业务语义配置interactiveFilters，最多16项，不预设国家或日期键。支持单选、多选、日期/月范围、数值范围、文本、布尔、NULL。filters固定范围始终保留；清空时间/数值选择仍受min/max约束。动态选项查授权原表DISTINCT，支持搜索和每页50项分页；dependsOn声明级联父筛选，改变上级会清空下级。Top20排名不能充当完整选项。页面只提交值，不能提交字段表达式或SQL。',
 interactiveFilterTypes:['select','multiSelect','dateRange','monthRange','numberRange','text','boolean','null'],
 interactiveFilterExample:[
  {id:'country',label:'国家',field:'country',type:'multiSelect',dynamic:true},
  {id:'brand',label:'品牌',field:'brand',type:'select',dynamic:true,dependsOn:['country']},
  {id:'period',label:'月份',field:'part_ym',type:'monthRange',storageFormat:'YYYYMM',min:'2026-01',max:'2026-12',defaultValue:{start:'2026-09',end:'2026-09'}},
  {id:'amount',label:'金额',field:'amount',type:'numberRange'},
  {id:'customer',label:'客户名称',field:'customer_name',type:'text',match:'contains'}],
 temporalFilterBehavior:'DATE使用dateRange；时间戳明确storageFormat:timestamp，结束日期采用次日零点排他上限以覆盖整天；带时区类型须核实utcOffset（固定偏移，不自动处理夏令时）。文本/整数日期核实YYYY-MM-DD或YYYYMMDD；月份使用monthRange及YYYYMM、YYYY-MM、YYYY-MM-01。不自动猜测格式。',
 limits:{maxInteractiveFilters:16,maxMultiValues:50,maxStaticOptions:500,optionPageSize:50,maxOptionOffset:10000,maxRequestBytes:64000},
 sourceExample:{elements:[{id:'sales-total',title:'销量',query:'totals',fields:['m0'],processing:'直接展示汇总销量'}]},
 workflow:'先预检 spec；试运行通过后生成HTML和provenance，再预检并保存。报错按stage/path修复；同一错误修复一次仍重复时查询诊断，不猜后台SQL，不反复改无关字段。能力缺口先与用户明确范围。',
}
