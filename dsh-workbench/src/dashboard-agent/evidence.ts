import type { DashboardFieldMapping, FieldProfile } from '../data-ingestion/csv-profile.js'
import type { SemanticContext } from '../data-connectors/openmetadata-mcp.js'
import type { MappingEvidence, MetricDefinition, MetricEvidence, PlanConfirmationState } from './contracts.js'

const normalize = (value: string) => value.toLowerCase().replace(/[\s_\-()（）【】\[\]/.:]/g, '')
const textRoles = new Set(['category', 'dimension', 'country', 'region', 'item'])
const dateRoles = new Set(['date', 'period'])

function expectedType(role: string): FieldProfile['inferredType'] | undefined {
  if (dateRoles.has(role)) return 'date'
  if (textRoles.has(role)) return 'text'
  return ['planned', 'published', 'views', 'conversions', 'revenue', 'cost', 'profit', 'forecast', 'shipments', 'sellIn', 'sellOut', 'inventory', 'dos', 'targetDos'].includes(role) ? 'number' : undefined
}

function nameScore(role: string, column: string): number {
  const name = normalize(column)
  const tokens: Record<string, string[]> = {
    date: ['date', '日期', '时间', 'day'], period: ['period', 'week', 'weekly', 'turnover', 'trunover', 'snapshot', 'stat', 'date', '月份', '期间'],
    item: ['item', 'sku', 'model', '产品', '型号'], country: ['country', '国家', '市场'], region: ['region', '区域', '大区', '地区部'],
    inventory: ['inventory', 'stock', '库存'], sellOut: ['sellout', '销售', '零售'], sellIn: ['sellin', '进货'], dos: ['dos', '周转'], targetDos: ['targetdos', '目标dos', '目标周转'],
  }
  const hits = (tokens[role] ?? [role]).reduce((score, token) => score + (name.includes(normalize(token)) ? 4 : 0), 0)
  const exact = name === normalize(role) ? 8 : 0
  const operationalPreference = (role === 'inventory' && /total/.test(name) ? 2 : 0)
    + ((role === 'sellIn' || role === 'sellOut') && /period/.test(name) ? 2 : 0)
  return hits + exact + operationalPreference - (/(start|end|开始|结束)/.test(name) ? 3 : 0) - (/(7|15|new)$/.test(name) ? 2 : 0)
}

function semanticMatches(role: string, column: string, semanticContext: SemanticContext): string[] {
  if (semanticContext.status !== 'verified') return []
  const needle = [normalize(role), normalize(column)]
  return semanticContext.assets.filter(asset => {
    const text = normalize([asset.fqn, asset.description ?? '', ...(asset.glossaryTerms ?? []), ...(asset.tags ?? [])].join(' '))
    return needle.some(value => value.length >= 3 && text.includes(value))
  }).map(asset => `openmetadata:${asset.fqn}`)
}

/**
 * Data checks are corroborating evidence, not a substitute for a business
 * definition. They can automatically accept an unambiguous, type-compatible
 * mapping, and deliberately surface ties or contradictions for people.
 */
export function assessMappingEvidence(mapping: DashboardFieldMapping, fields: FieldProfile[], semanticContext: SemanticContext): MappingEvidence[] {
  return Object.entries(mapping).filter(([, column]) => Boolean(column)).map(([role, column]) => {
    const field = fields.find(item => item.name === column)
    if (!column || !field) return { role, column, status: 'needs-review', confidence: 0, sourceIds: [], checks: ['映射列不存在于当前数据集。'], reason: '需要选择有效的数据列。' }
    const expected = expectedType(role)
    const typeMatch = !expected || field.inferredType === expected
    const completeness = fields.length ? field.nonEmpty : 0
    const matchingFields = expected ? fields.filter(item => item.inferredType === expected && nameScore(role, item.name) > 0) : []
    const selectedScore = nameScore(role, field.name)
    const runnerUp = matchingFields.filter(item => item.name !== field.name).map(item => nameScore(role, item.name)).sort((a, b) => b - a)[0] ?? -Infinity
    const ambiguous = selectedScore <= 0 || runnerUp >= selectedScore
    const omdSources = semanticMatches(role, column, semanticContext)
    const checks = [`类型${typeMatch ? '匹配' : '不匹配'}：期望 ${expected ?? '任意'}，实际 ${field.inferredType}。`, `已观测到 ${completeness} 个非空值。`]
    if (omdSources.length) return { role, column, status: 'omd-verified', confidence: 95, sourceIds: omdSources, checks, reason: 'OMD 定义与当前字段名称/术语匹配。' }
    if (typeMatch && field.nonEmpty > 0 && !ambiguous) return { role, column, status: 'data-validated', confidence: 82, sourceIds: [], checks, reason: '字段类型、非空情况和候选唯一性通过数据校验；OMD 未提供字段级定义。' }
    checks.push(ambiguous ? '存在多个语义相近候选列。' : '字段类型或有效值不足以支持该角色。')
    return { role, column, status: 'needs-review', confidence: typeMatch ? 55 : 25, sourceIds: [], checks, reason: ambiguous ? '需要在相近字段中确认业务口径。' : '数据验证未能支持该字段角色。' }
  })
}

export function assessMetricEvidence(metrics: MetricDefinition[], mappingEvidence: MappingEvidence[], mapping: DashboardFieldMapping): MetricEvidence[] {
  const byRole = new Map(mappingEvidence.map(item => [item.role, item]))
  return metrics.map(metric => {
    const sourceRoles = Object.keys(mapping).filter(role => new RegExp(`\\b${role}\\b`, 'i').test(metric.expression))
    const inputs = sourceRoles.map(role => byRole.get(role)).filter((item): item is MappingEvidence => Boolean(item))
    const unresolved = inputs.filter(item => item.status === 'needs-review')
    const omdSources = [...new Set(inputs.flatMap(item => item.sourceIds))]
    if (unresolved.length) return { metricId: metric.id, status: 'needs-review', confidence: Math.min(...unresolved.map(item => item.confidence)), sourceIds: omdSources, checks: unresolved.map(item => `${item.role}：${item.reason}`), reason: '依赖字段仍有未解决的业务歧义。' }
    if (inputs.length && inputs.every(item => item.status === 'omd-verified')) return { metricId: metric.id, status: 'omd-verified', confidence: 95, sourceIds: omdSources, checks: ['指标公式为系统受控公式，所有输入字段均已由 OMD 验证。'], reason: '无需重复确认。' }
    return { metricId: metric.id, status: 'data-validated', confidence: inputs.length ? Math.min(...inputs.map(item => item.confidence)) : 50, sourceIds: omdSources, checks: ['指标公式为系统受控公式，输入字段通过数据校验。'], reason: '无需重复确认；请在数据口径变化时重新评估。' }
  })
}

export function deriveConfirmationState(mappingEvidence: MappingEvidence[], metricEvidence: MetricEvidence[]): PlanConfirmationState {
  const mappingRolesNeedingReview = mappingEvidence.filter(item => item.status === 'needs-review').map(item => item.role)
  const metricIdsNeedingReview = metricEvidence.filter(item => item.status === 'needs-review').map(item => item.metricId)
  return {
    autoAcceptedMappingRoles: mappingEvidence.filter(item => item.status !== 'needs-review').map(item => item.role),
    autoAcceptedMetricIds: metricEvidence.filter(item => item.status !== 'needs-review').map(item => item.metricId),
    mappingRolesNeedingReview, metricIdsNeedingReview,
    optionalMappingRoles: [],
    reasons: [...mappingEvidence.filter(item => item.status === 'needs-review').map(item => `${item.role}：${item.reason}`), ...metricEvidence.filter(item => item.status === 'needs-review').map(item => `${item.metricId}：${item.reason}`)],
  }
}
