import type { DashboardSpec } from '../dashboard-agent/contracts.js'

export const REQUIRED_COLUMNS = ['date', 'category', 'planned', 'published', 'views', 'conversions', 'revenue'] as const
export type RequiredColumn = typeof REQUIRED_COLUMNS[number]
export type DashboardDataContract = 'content-ops-v1' | 'finance-pnl-v1' | 'supply-sales-v1' | 'sku-operations-v1'

export interface ContentRecord {
  date: string
  category: string
  planned: number
  published: number
  views: number
  conversions: number
  revenue: number
}

export interface DataQualityReport {
  validRows: number
  rejectedRows: Array<{ row: number; reason: string }>
  dateRange?: { start: string; end: string }
}

export interface CategoryMetric {
  category: string
  published: number
  views: number
  conversions: number
  revenue: number
  conversionRate: number
}

export interface ContentDashboardModel {
  timeframe: string
  freshness: string
  conclusion: string
  kpis: {
    published: number
    planCompletion: number
    views: number
    conversionRate: number
    revenue: number
  }
  trend: Array<{ date: string; published: number; views: number; revenue: number }>
  categories: CategoryMetric[]
  diagnostic: string
  actions: Array<{ priority: '高' | '中'; evidence: string; nextStep: string; expectedDirection: string }>
}

export interface FinanceDashboardModel {
  kind: 'finance-pnl-v1'
  timeframe: string
  freshness: string
  conclusion: string
  kpis: { revenue: number; cost: number; profit: number; profitMargin: number; costRatio: number }
  trend: Array<{ period: string; revenue: number; cost: number; profit: number }>
  dimensions: Array<{ dimension: string; revenue: number; cost: number; profit: number; profitMargin: number }>
  diagnostic: string
  actions: Array<{ priority: '高' | '中'; evidence: string; nextStep: string; expectedDirection: string }>
}

export interface SupplySalesDashboardModel {
  kind: 'supply-sales-v1'
  timeframe: string
  snapshotPeriod: string
  freshness: string
  conclusion: string
  kpis: { forecast: number; shipments: number; sellIn: number; sellOut: number; inventory: number; inventoryDos: number | undefined; targetDos: number | undefined; dosToTarget: number | undefined; shipmentFulfillment: number; inventoryConcentration: number }
  trend: Array<{ period: string; forecast: number; shipments: number; sellIn: number; sellOut: number }>
  countries: Array<{ country: string; region: string; sellIn: number; sellOut: number; inventory: number; dos: number | undefined; targetDos: number | undefined; dosToTarget: number | undefined; forecastAchievement: number }>
  regions: Array<{ region: string; inventory: number; sellOut: number; dos: number | undefined; targetDos: number | undefined; dosToTarget: number | undefined }>
  diagnostic: string
  actions: Array<{ priority: '高' | '中'; evidence: string; nextStep: string; expectedDirection: string }>
}

/** A renderer-owned projection of a confirmed DashboardSpec. */
export interface SpecDrivenDashboardModel {
  kind: 'spec-driven-v1'
  title: string
  timeframe: string
  freshness: string
  conclusion: string
  kpis: Array<{ id: string; name: string; value: number | undefined; format: 'number' | 'currency' | 'percent' | 'duration'; expression: string }>
  charts: Array<{ id: string; title: string; type: string; dimension: string; metrics: string[]; rows: Array<{ label: string; values: Record<string, number | undefined> }> }>
  detailColumns: string[]
  detailRows: Array<Record<string, string>>
  /** Compact mapped rows embedded in the offline page for global filter interactions. */
  filterRows: Array<Record<string, string>>
  diagnostics: string[]
  storylinePlan: DashboardSpec['storylinePlan']
}

export type DashboardModel = ContentDashboardModel | FinanceDashboardModel | SupplySalesDashboardModel | SpecDrivenDashboardModel

export interface DashboardBuildResult<TModel extends DashboardModel = DashboardModel> {
  html: string
  quality: DataQualityReport
  model: TModel
  template: DashboardTemplate
}

export interface DashboardTemplate {
  id: string
  displayName: string
  dataContract: DashboardDataContract
  expectedColumns: readonly string[]
  requiredKpis: readonly string[]
}

export interface DashboardBuildInput {
  displayName?: string
  sourceLabel?: string
  templateId?: string
  mapping?: Record<string, string | undefined>
  /** Build only from a confirmed DashboardSpec when the request originated from the Agent workflow. */
  spec?: DashboardSpec
  /** Private technical identifiers that must be scrubbed from an offline export. */
  privateTerms?: string[]
}
