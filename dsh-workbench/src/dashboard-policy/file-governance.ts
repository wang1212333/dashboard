import type { DashboardSpec, MetricDefinition } from '../dashboard-agent/contracts.js'
import { parseTabularCsv } from '../data-ingestion/csv-profile.js'
import type { DashboardGovernanceInput } from './governance.js'
import type { MetricContract } from './metric-contract.js'

/**
 * Produces the governance payload for a confirmed, file-only dashboard.
 * The workbench, not the model, derives this mechanical evidence record so an
 * Agent never has to invent low-level governance fields.
 */
export function createFileOnlyGovernance(spec: DashboardSpec, csv: string): DashboardGovernanceInput {
  const dataset = parseTabularCsv(csv)
  const periodField = spec.mapping.period ?? spec.mapping.date
  const periods = periodField && dataset.headers.includes(periodField)
    ? dataset.rows.map(row => row[periodField] ?? '').filter(Boolean).sort((left, right) => left.localeCompare(right))
    : []
  const start = periods[0] ?? '未标注'
  const end = periods.at(-1) ?? start
  const dimensionField = spec.mapping.country ?? spec.mapping.dimension ?? spec.mapping.category ?? Object.entries(spec.mapping).find(([role, field]) => role !== 'period' && role !== 'date' && Boolean(field))?.[1]
  const grain = [periodField, dimensionField].filter((field): field is string => Boolean(field)).join(' × ') || '上传数据集'
  const evidenceSourceIds = spec.semanticContext.evidenceSourceIds.length ? spec.semanticContext.evidenceSourceIds : ['file:uploaded-csv']
  const metrics = spec.metrics.slice(0, 4).map(metric => metricContract(metric, grain, start, end, evidenceSourceIds))
  return {
    routing: {
      confirmedProduct: false,
      sources: [{ id: 'file:uploaded-csv', kind: 'file', businessRole: 'actual', usable: true, contributions: ['kpi', 'comparison', 'filter', 'diagnostic', 'detail', 'action'] }],
    },
    metrics,
    datasets: [{ id: 'file:uploaded-csv', metricLabel: '上传数据集', role: 'actual', unit: '记录', grain, timeframe: `${start} 至 ${end}` }],
    relationships: [],
    components: ['kpi', 'trend', 'comparison', 'diagnostic', 'action', 'detail', 'filter'],
    businessConfirmed: true,
  }
}

function metricContract(metric: MetricDefinition, grain: string, start: string, end: string, evidenceSourceIds: string[]): MetricContract {
  return {
    label: metric.name,
    definition: `基于 ${metric.sourceFields.join('、') || '已映射字段'}，按 ${metric.expression} 计算。`,
    formula: metric.expression,
    unit: metric.format === 'currency' ? '货币' : metric.format === 'percent' ? '%' : metric.format === 'duration' ? '天' : '数值',
    direction: metric.format === 'duration' ? 'range-bound' : 'higher-is-better',
    grain,
    timeframe: { start, end, timezone: 'Asia/Shanghai' },
    comparison: 'none',
    valueRole: 'actual',
    evidenceSourceIds,
  }
}
