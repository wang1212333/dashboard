export type InferredFieldType = 'date' | 'number' | 'text'
export type DashboardFieldMapping = Record<string, string | undefined>

export interface CsvDataset {
  headers: string[]
  rows: Array<Record<string, string>>
}

export interface FieldProfile {
  name: string
  inferredType: InferredFieldType
  nonEmpty: number
  samples: string[]
}

export interface TemplateRecommendation {
  templateId: 'content-ops-v1' | 'finance-pnl-v1' | 'supply-sales-v1' | 'sku-operations-v1'
  confidence: number
  reason: string
  mapping: DashboardFieldMapping
}

export interface CsvAnalysis {
  headers: string[]
  previewRows: Array<Record<string, string>>
  rowCount: number
  fields: FieldProfile[]
  recommendations: TemplateRecommendation[]
}

function parseRows(csv: string): string[][] {
  const rows: string[][] = []
  let cell = ''
  let row: string[] = []
  let quoted = false
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]
    const next = csv[index + 1]
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (character === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell.trim()); cell = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
      continue
    }
    cell += character
  }
  if (quoted) throw new Error('CSV_QUOTE_UNCLOSED')
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export function parseTabularCsv(csv: string): CsvDataset {
  const rows = parseRows(csv)
  if (rows.length < 2) throw new Error('CSV_HAS_NO_DATA')
  const headers = rows[0].map((header, index) => header.replace(/^\uFEFF/, '').trim() || `column_${index + 1}`)
  if (new Set(headers).size !== headers.length) throw new Error('CSV_HEADERS_DUPLICATE')
  return { headers, rows: rows.slice(1).filter((row) => row.some(Boolean)).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))) }
}

const normal = (value: string) => value.toLowerCase().replace(/[\s_\-()（）【】\[\]\/]/g, '')
const dateLike = (value: string) => /^\d{4}[-/.年]\d{1,2}([-/\.月]\d{1,2}日?)?$/.test(value) || /^\d{4}q[1-4]$/i.test(value)
const numberLike = (value: string) => /^[-+]?\(?[¥￥$]?\s?[\d,]+(?:\.\d+)?\)?%?$/.test(value)

function inferType(values: string[]): InferredFieldType {
  const present = values.filter(Boolean)
  if (present.length === 0) return 'text'
  if (present.filter(dateLike).length / present.length >= 0.8) return 'date'
  if (present.filter(numberLike).length / present.length >= 0.8) return 'number'
  return 'text'
}

function firstHeader(headers: string[], aliases: string[]): string | undefined {
  return headers.find((header) => aliases.some((alias) => normal(header).includes(normal(alias))))
}

/** Prefer the canonical field when several similarly named measures coexist. */
function exactHeader(headers: string[], candidates: string[]): string | undefined {
  return candidates.map(candidate => headers.find(header => normal(header) === normal(candidate))).find((header): header is string => Boolean(header))
}

function recommendation(headers: string[], templateId: TemplateRecommendation['templateId'], roles: Array<[string, string[]]>, reason: string): TemplateRecommendation {
  const mapping = Object.fromEntries(roles.map(([role, aliases]) => [role, firstHeader(headers, aliases)]))
  const matched = Object.values(mapping).filter(Boolean).length
  return { templateId, confidence: Math.round(matched / roles.length * 100), reason, mapping }
}

export function analyzeCsv(csv: string): CsvAnalysis {
  const dataset = parseTabularCsv(csv)
  const fields = dataset.headers.map((name) => {
    const values = dataset.rows.map((row) => row[name]).filter(Boolean)
    return { name, inferredType: inferType(values), nonEmpty: values.length, samples: values.slice(0, 3) }
  })
  const content = recommendation(dataset.headers, 'content-ops-v1', [
    ['date', ['date', '日期', '时间', 'day']], ['category', ['category', '品类', '分类', '内容类型']], ['planned', ['planned', '计划']], ['published', ['published', '发布']], ['views', ['views', '浏览', '曝光', '阅读']], ['conversions', ['conversions', '转化', '成交']], ['revenue', ['revenue', '收入', '营收', '销售额']],
  ], '适用于有日期、内容分类、发布与浏览/转化数据的运营表。')
  const finance = recommendation(dataset.headers, 'finance-pnl-v1', [
    ['period', ['period', '日期', '期间', '会计期间', '月份', 'month']], ['dimension', ['dimension', '科目', '项目', '部门', '产品', '业务']], ['revenue', ['revenue', '营业收入', '收入', '营收', '销售额']], ['cost', ['cost', '成本', '营业成本', '费用']], ['profit', ['profit', '净利润', '利润', '毛利']],
  ], '适用于有期间、收入、成本或利润字段的财务/经营表。')
  const supplySales = recommendation(dataset.headers, 'supply-sales-v1', [
    ['period', ['period', '统计月份', '月份', 'month', '期间', '日期', 'date', 'weeklydate']], ['country', ['country', '国家名称', '国家', '市场']], ['forecast', ['forecast', 'drp2', '预测']], ['shipments', ['shipments', 'sap发货', '发货']], ['sellIn', ['sellin', 'si']], ['sellOut', ['sellout', 'so']], ['inventory', ['inventory', '全渠道库存', '库存', 'stock']], ['dos', ['渠道dos', 'dos']], ['targetDos', ['targetdos', '目标dos', '目标周转']], ['region', ['region', '地区部', '大区', '区域']],
  ], '适用于按期间、市场、产品记录计划、发货、进销存和库存周转的产销协同表。')
  const skuOperations = recommendation(dataset.headers, 'sku-operations-v1', [
    ['period', ['period', '统计月份', '月份', 'month', '期间', '日期', 'date', 'weeklydate']], ['item', ['item', 'sku', 'model', '型号', '产品']], ['inventory', ['inventory', '全渠道库存', '库存', 'stock']], ['sellOut', ['sellout', '销售', '零售']], ['dos', ['渠道dos', 'dos', '周转']], ['targetDos', ['targetdos', '目标dos', '目标周转']], ['region', ['region', '地区部', '大区', '区域']], ['country', ['country', '国家名称', '国家', '市场']],
  ], '适用于按 SKU / 产品明细记录库存、销售、周转和区域市场表现的数据；页面由已确认故事线动态编排。')
  // A header such as period_sell_in is a metric, not a time dimension. Prefer
  // the profiled date column whenever the source actually contains one.
  const profiledDate = fields.filter(field => field.inferredType === 'date').sort((left, right) => periodFieldScore(right.name) - periodFieldScore(left.name))[0]?.name
  if (profiledDate) {
    supplySales.mapping.period = profiledDate
    skuOperations.mapping.period = profiledDate
  }
  // In SKU data, an explicit `item` column is more granular and stable than
  // an earlier generic model/product alias.
  const explicitItem = dataset.headers.find(header => normal(header) === 'item')
  if (explicitItem) skuOperations.mapping.item = explicitItem
  // `period_*` is a period flow whereas `total_*` is the requested cumulative
  // sell-out measure; `total_chnl_dos` is an aggregate coverage field whereas
  // `chnl_dos` is the SKU/channel DOS. Do not let header order decide either.
  skuOperations.mapping.sellOut = exactHeader(dataset.headers, ['total_sell_out']) ?? skuOperations.mapping.sellOut
  skuOperations.mapping.dos = exactHeader(dataset.headers, ['chnl_dos']) ?? skuOperations.mapping.dos
  skuOperations.mapping.targetDos = exactHeader(dataset.headers, ['country_dim_chnl_target_dos']) ?? skuOperations.mapping.targetDos
  skuOperations.mapping.region = exactHeader(dataset.headers, ['large_area_name_cn', 'large_area_name_cn_second', 'large_area_name_cn_third']) ?? skuOperations.mapping.region
  return { headers: dataset.headers, previewRows: dataset.rows.slice(0, 5), rowCount: dataset.rows.length, fields, recommendations: [skuOperations, supplySales, finance, content].sort((left, right) => right.confidence - left.confidence) }
}

function periodFieldScore(name: string): number {
  const value = normal(name)
  return (/(weekly|week|turnover|trunover|snapshot|stat|update|period|month|date|日期|周)/.test(value) ? 10 : 0)
    - (/(start|end|开始|结束)/.test(value) ? 8 : 0)
}

/** Converts a user-confirmed field mapping to the existing canonical content CSV contract. */
export function mapToContentCsv(csv: string, mapping: DashboardFieldMapping): string {
  const dataset = parseTabularCsv(csv)
  const roles = ['date', 'category', 'planned', 'published', 'views', 'conversions', 'revenue']
  const missing = roles.filter((role) => !mapping[role] || !dataset.headers.includes(mapping[role]!))
  if (missing.length) throw new Error(`MAPPING_REQUIRED:${missing.join(',')}`)
  const escape = (value: string) => /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  return [roles.join(','), ...dataset.rows.map((row) => roles.map((role) => escape(row[mapping[role]!] ?? '')).join(','))].join('\n')
}
