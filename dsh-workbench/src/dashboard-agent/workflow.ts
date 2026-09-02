import type { CsvAnalysis, DashboardFieldMapping } from '../data-ingestion/csv-profile.js'
import type { ChartSpec, DashboardPlan, DashboardPlanConfirmation, DashboardPlanInput, DashboardSpec, DatasetProfile, FilterSpec, MetricDefinition, StorylinePlan } from './contracts.js'
import { isSemanticContext, unavailableSemanticContext } from '../data-connectors/openmetadata-mcp.js'
import { defaultInformationArchitecture, isDashboardVisualContract, normalizeDashboardVisualContract } from '../dashboard-build/universal-contract.js'
import { isCsvSourceSnapshot } from '../data-ingestion/source-integrity.js'
import { assessMappingEvidence, assessMetricEvidence, deriveConfirmationState } from './evidence.js'

const TEMPLATE_ROLES: Record<DashboardPlan['templateId'], string[]> = {
  'content-ops-v1': ['date', 'category', 'planned', 'published', 'views', 'conversions', 'revenue'],
  'finance-pnl-v1': ['period', 'dimension', 'revenue', 'cost', 'profit'],
  'supply-sales-v1': ['period', 'country', 'forecast', 'shipments', 'sellIn', 'sellOut', 'inventory', 'dos'],
  'sku-operations-v1': ['period', 'item', 'inventory'],
}

export function createDashboardPlan(input: DashboardPlanInput): DashboardPlan {
  const dataset = profile(input)
  const semanticContext = isSemanticContext(input.semanticContext) ? input.semanticContext : unavailableSemanticContext(input.businessGoal)
  const visualContract = normalizeDashboardVisualContract(input.visualContract)
  const requiredRoles = TEMPLATE_ROLES[input.templateId]
  const missingRoles = requiredRoles.filter(role => !input.mapping[role])
  const semanticRisks = semanticContext.status === 'verified' ? [] : semanticContext.issues.map(issue => `语义检索:${issue}`)
  const risks = [...new Set([...(input.riskHints ?? []), ...semanticRisks, ...missingRoles.map(role => `字段角色待确认:${role}`), ...(dataset.dateFields.length ? [] : ['未识别时间字段；趋势与同比口径需要确认。'])])]
  const metrics = metricDefinitions(input.templateId, input.mapping, semanticContext.evidenceSourceIds)
  const mappingEvidence = assessMappingEvidence(input.mapping, input.fields, semanticContext)
  const metricEvidence = assessMetricEvidence(metrics, mappingEvidence, input.mapping)
  const baseConfirmationState = deriveConfirmationState(mappingEvidence, metricEvidence)
  const metricRolesNeedingReview = new Set(metrics.filter(metric => metricEvidence.some(evidence => evidence.metricId === metric.id && evidence.status === 'needs-review')).flatMap(metric => Object.keys(input.mapping).filter(role => new RegExp(`\\b${role}\\b`, 'i').test(metric.expression))))
  const optionalMappingRoles = baseConfirmationState.mappingRolesNeedingReview.filter(role => !requiredRoles.includes(role) && !metricRolesNeedingReview.has(role))
  const mappingRolesNeedingReview = [...new Set([...baseConfirmationState.mappingRolesNeedingReview.filter(role => requiredRoles.includes(role) || metricRolesNeedingReview.has(role)), ...missingRoles])]
  const confirmationState = {
    ...baseConfirmationState,
    mappingRolesNeedingReview, optionalMappingRoles,
    reasons: [...baseConfirmationState.reasons.filter(reason => !optionalMappingRoles.some(role => reason.startsWith(`${role}：`))), ...missingRoles.map(role => `${role}：未找到可用的字段映射。`)],
  }
  const filters = filterDefinitions(input.templateId, input.mapping)
  const charts = chartDefinitions(input.templateId, metrics.map(metric => metric.id))
  const storylinePlan = normalizeStorylinePlan(input.storylinePlan, input.templateId, input.businessGoal, metrics, charts, input.mapping, risks)
  return {
    schemaVersion: 'dashboard-plan/v1', planId: input.planId, status: 'needs_confirmation',
    intent: {
      title: input.title?.trim() || defaultTitle(input.templateId), businessGoal: input.businessGoal.trim(), dashboardType: dashboardType(input.templateId),
      audience: input.audience?.filter(Boolean) ?? [], decisions: input.decisions?.filter(Boolean) ?? [], scope: {},
      expectedMetrics: metrics.map(metric => metric.name), expectedDimensions: filters.map(filter => filter.label),
      inferredItems: Object.entries(input.mapping).filter(([, value]) => Boolean(value)).map(([role, value]) => ({ field: role, value: value!, confidence: 75, basis: 'data' as const })),
      blockingQuestions: [...confirmationState.reasons, ...risks.filter(risk => risk.startsWith('未识别时间') || (semanticContext.status === 'incomplete' && risk.startsWith('语义检索:')))],
    },
    dataset, source: input.source, semanticContext, informationArchitecture: defaultInformationArchitecture(), visualContract, templateId: input.templateId, mapping: { ...input.mapping }, mappingEvidence, metrics, metricEvidence, confirmationState, filters, charts,
    storylinePlan, storyline: storylinePlan.pages.map(page => page.title), risks,
  }
}

export function planFromAnalysis(analysis: CsvAnalysis, input: Omit<DashboardPlanInput, 'templateId' | 'mapping' | 'fields' | 'rowCount'> & { templateId?: DashboardPlan['templateId']; mapping?: DashboardFieldMapping }): DashboardPlan {
  const recommendation = input.templateId ? analysis.recommendations.find(item => item.templateId === input.templateId) : analysis.recommendations[0]
  if (!recommendation) throw new Error('DASHBOARD_TEMPLATE_RECOMMENDATION_REQUIRED')
  const riskHints = [...(input.riskHints ?? [])]
  if (recommendation.confidence < 60) riskHints.push(`候选模板置信度仅 ${recommendation.confidence}%；请确认字段映射与业务问题。`)
  return createDashboardPlan({ ...input, templateId: recommendation.templateId, mapping: input.mapping ?? recommendation.mapping, fields: analysis.fields, rowCount: analysis.rowCount, riskHints })
}

export function confirmDashboardPlan(plan: DashboardPlan, confirmation: DashboardPlanConfirmation): DashboardSpec {
  if (!plan || plan.schemaVersion !== 'dashboard-plan/v1' || plan.status !== 'needs_confirmation' || !Array.isArray(plan.metrics) || !Array.isArray(plan.charts)) throw new Error('DASHBOARD_PLAN_NOT_CONFIRMABLE')
  if (!confirmation.businessConfirmed) throw new Error('BUSINESS_CONFIRMATION_REQUIRED')
  if (!confirmation.storylineConfirmed) throw new Error('STORYLINE_CONFIRMATION_REQUIRED')
  const mapping = { ...plan.mapping }
  const missing = TEMPLATE_ROLES[plan.templateId].filter(role => !mapping[role])
  if (missing.length) throw new Error(`MAPPING_REQUIRED:${missing.join(',')}`)
  return {
    schemaVersion: 'dashboard-spec/v1', planId: plan.planId, title: plan.intent.title, templateId: plan.templateId,
    intent: { ...plan.intent, blockingQuestions: [] }, source: plan.source, semanticContext: plan.semanticContext, informationArchitecture: plan.informationArchitecture, visualContract: plan.visualContract, mapping, mappingEvidence: plan.mappingEvidence,
    metrics: plan.metrics.map(metric => ({ ...metric, confirmed: true })),
    metricEvidence: plan.metricEvidence, confirmationState: plan.confirmationState, filters: plan.filters, charts: plan.charts.map(chart => ({ ...chart, confirmed: true })), storylinePlan: plan.storylinePlan, storyline: plan.storyline,
    confirmedAt: new Date().toISOString(),
  }
}

export function isDashboardSpec(value: unknown): value is DashboardSpec {
  if (!value || typeof value !== 'object') return false
  const spec = value as Partial<DashboardSpec>
  return spec.schemaVersion === 'dashboard-spec/v1' && typeof spec.planId === 'string' && typeof spec.title === 'string'
    && (spec.templateId === 'content-ops-v1' || spec.templateId === 'finance-pnl-v1' || spec.templateId === 'supply-sales-v1' || spec.templateId === 'sku-operations-v1')
    && isCsvSourceSnapshot(spec.source)
    && isSemanticContext(spec.semanticContext)
    && isDashboardVisualContract(spec.visualContract)
    && spec.informationArchitecture?.templateId === 'universal-dashboard/v1'
    && Array.isArray(spec.metrics) && spec.metrics.every(metric => metric.confirmed)
    && Array.isArray(spec.mappingEvidence) && Array.isArray(spec.metricEvidence) && Boolean(spec.confirmationState)
    && Array.isArray(spec.charts) && spec.charts.every(chart => chart.confirmed)
    && isStorylinePlan(spec.storylinePlan, spec.metrics, spec.charts)
}

function profile(input: DashboardPlanInput): DatasetProfile {
  const dateFields = input.fields.filter(field => field.inferredType === 'date').map(field => field.name)
  const numberFields = input.fields.filter(field => field.inferredType === 'number').map(field => field.name)
  const dimensions = input.fields.filter(field => field.inferredType === 'text').map(field => field.name)
  return { fileName: input.fileName, rowCount: input.rowCount, fields: input.fields, dateFields, numberFields, inferredGrain: [dateFields[0], dimensions[0]].filter(Boolean).join(' × ') || '待确认', qualityRisks: input.riskHints ?? [] }
}
function dashboardType(templateId: DashboardPlan['templateId']): DashboardPlan['intent']['dashboardType'] { return templateId === 'finance-pnl-v1' ? 'reporting' : templateId === 'supply-sales-v1' ? 'monitoring' : 'operations' }
function defaultTitle(templateId: DashboardPlan['templateId']): string { return templateId === 'finance-pnl-v1' ? '经营损益分析看板' : templateId === 'supply-sales-v1' ? '产销协同驾驶舱' : templateId === 'sku-operations-v1' ? 'SKU 运营工作台' : '内容运营看板' }
function metricDefinitions(templateId: DashboardPlan['templateId'], mapping: DashboardFieldMapping, semanticEvidenceSourceIds: string[]): MetricDefinition[] {
  const roles = templateId === 'content-ops-v1'
    ? [['published', '发布量', 'SUM(published)', 'sum', 'number'], ['planCompletion', '计划完成率', 'SUM(published) / SUM(planned)', 'ratio', 'percent'], ['views', '浏览量', 'SUM(views)', 'sum', 'number'], ['conversionRate', '转化率', 'SUM(conversions) / SUM(views)', 'ratio', 'percent']]
    : templateId === 'finance-pnl-v1'
      ? [['revenue', '收入', 'SUM(revenue)', 'sum', 'currency'], ['cost', '成本', 'SUM(cost)', 'sum', 'currency'], ['profit', '利润', 'SUM(profit)', 'sum', 'currency'], ['profitMargin', '利润率', 'SUM(profit) / SUM(revenue)', 'ratio', 'percent']]
      : templateId === 'sku-operations-v1'
        // SKU datasets use point-in-time snapshots. Cumulative sell-out must
        // therefore come from the latest complete snapshot, not be summed
        // again across weekly extracts.
        ? [['inventory', '库存', 'LATEST_SUM(inventory)', 'sum', 'number'], ['sellOut', '累计销售', 'LATEST_SUM(sellOut)', 'sum', 'number'], ['dos', 'DOS周转天数', 'LATEST_WEIGHTED_AVG(dos, inventory)', 'avg', 'duration'], ['targetDos', '目标DOS', 'LATEST_WEIGHTED_AVG(targetDos, inventory)', 'avg', 'duration'], ['dosCompliance', 'DOS/目标DOS', 'LATEST_WEIGHTED_AVG(dos, inventory) / LATEST_WEIGHTED_AVG(targetDos, inventory)', 'ratio', 'percent'], ['inventoryConcentration', '库存集中度', 'LATEST_TOP5_SUM(inventory) / LATEST_SUM(inventory)', 'ratio', 'percent']]
        : [['forecast', '预测', 'SUM(forecast)', 'sum', 'number'], ['shipments', '发货', 'SUM(shipments)', 'sum', 'number'], ['sellIn', '进货', 'SUM(sellIn)', 'sum', 'number'], ['sellOut', '销售', 'SUM(sellOut)', 'sum', 'number'], ['inventory', '库存', 'SUM(inventory)', 'sum', 'number'], ['dos', 'DOS周转天数', 'WEIGHTED_AVG(dos, inventory)', 'avg', 'duration'], ['targetDos', '目标DOS', 'WEIGHTED_AVG(targetDos, inventory)', 'avg', 'duration'], ['dosCompliance', 'DOS/目标DOS', 'WEIGHTED_AVG(dos, inventory) / WEIGHTED_AVG(targetDos, inventory)', 'ratio', 'percent'], ['shipmentFulfillment', '发货满足率', 'SUM(shipments) / SUM(forecast)', 'ratio', 'percent'], ['inventoryConcentration', '库存集中度', 'TOP5_SUM(inventory) / SUM(inventory)', 'ratio', 'percent']]
  const usable = templateId !== 'sku-operations-v1' ? roles : roles.filter(([id]) => id === 'inventory' || id === 'sellOut' ? Boolean(mapping[id]) : id === 'dos' ? Boolean(mapping.dos && mapping.inventory) : id === 'targetDos' ? Boolean(mapping.targetDos && mapping.inventory) : id === 'dosCompliance' ? Boolean(mapping.dos && mapping.targetDos && mapping.inventory) : id === 'inventoryConcentration' ? Boolean(mapping.inventory) : false)
  return usable.map(([id, name, expression, aggregation, format]) => ({ id, name, expression, aggregation: aggregation as MetricDefinition['aggregation'], format: format as MetricDefinition['format'], sourceFields: Object.values(mapping).filter((value): value is string => Boolean(value)), confidence: semanticEvidenceSourceIds.length ? 90 : 80, semanticEvidenceSourceIds: [...semanticEvidenceSourceIds], confirmed: false }))
}
function filterDefinitions(templateId: DashboardPlan['templateId'], mapping: DashboardFieldMapping): FilterSpec[] {
  const roles = templateId === 'content-ops-v1' ? ['date', 'category'] : templateId === 'finance-pnl-v1' ? ['period', 'dimension'] : templateId === 'sku-operations-v1' ? ['period', 'region', 'country', 'item'] : ['period', 'region', 'country']
  const labels: Record<string, string> = { date: '统计日期', period: '统计周期', category: '分类', dimension: '分析维度', region: '区域', country: '国家/市场', item: 'SKU/产品' }
  return roles.filter(role => mapping[role]).map(role => ({ id: `filter-${role}`, field: mapping[role]!, label: labels[role] ?? role, scope: 'global', required: role === roles[0] }))
}
function chartDefinitions(templateId: DashboardPlan['templateId'], availableMetricIds: string[] = []): ChartSpec[] {
  if (templateId === 'sku-operations-v1') {
    const supported = (ids: string[]) => ids.filter(id => availableMetricIds.includes(id))
    const charts: ChartSpec[] = []
    const trendMetrics = supported(['inventory', 'sellOut'])
    if (trendMetrics.length) charts.push({ id: 'trend', title: '库存与销售变化', question: '库存和销售在不同期间如何变化？', type: 'line', dimensions: ['period'], metrics: trendMetrics, confirmed: false })
    if (availableMetricIds.includes('inventory')) charts.push({ id: 'skuInventory', title: 'SKU 库存结构', question: '哪些 SKU 占用了主要库存？', type: 'bar', dimensions: ['item'], metrics: ['inventory'], confirmed: false })
    const dosMetrics = supported(['dos', 'targetDos'])
    if (dosMetrics.length) charts.push({ id: 'dosComparison', title: 'SKU DOS 对比', question: '哪些 SKU 的周转天数需要优先关注？', type: 'bar', dimensions: ['item'], metrics: dosMetrics, confirmed: false })
    charts.push({ id: 'detail', title: 'SKU 明细', question: '需要进一步核查哪些 SKU 与市场组合？', type: 'table', dimensions: ['item'], metrics: supported(['inventory', 'sellOut', 'dos', 'targetDos']), confirmed: false })
    return charts
  }
  const dimension = templateId === 'content-ops-v1' ? 'category' : templateId === 'finance-pnl-v1' ? 'dimension' : 'country'
  const period = templateId === 'content-ops-v1' ? 'date' : 'period'
  const metrics = templateId === 'content-ops-v1'
    ? { trend: ['published', 'views', 'revenue'], comparison: ['views', 'revenue'] }
    : templateId === 'finance-pnl-v1'
      ? { trend: ['revenue', 'cost', 'profit'], comparison: ['revenue', 'profit'] }
      : { trend: ['forecast', 'shipments', 'sellOut'], comparison: ['inventory', 'dos'] }
  const common = [{ id: 'trend', title: '趋势', question: '核心指标如何变化？', type: 'line' as const, dimensions: [period], metrics: metrics.trend, confirmed: false }, { id: 'comparison', title: '结构与差异', question: '哪些对象贡献或风险最大？', type: 'bar' as const, dimensions: [dimension], metrics: metrics.comparison, confirmed: false }]
  if (templateId !== 'supply-sales-v1') return [...common, { id: 'detail', title: '行动明细', question: '下一步应处理什么？', type: 'table', dimensions: [dimension], metrics: [], confirmed: false }]
  return [
    ...common,
    { id: 'inventoryShare', title: '地区库存占比', question: '库存主要集中在哪些地区？', type: 'pie', dimensions: ['region'], metrics: ['inventory'], confirmed: false },
    { id: 'dosComparison', title: 'DOS 与目标对比', question: '哪些国家存在积压或断货风险？', type: 'scatter', dimensions: ['country'], metrics: ['dos', 'targetDos'], confirmed: false },
    { id: 'detail', title: '国家库存行动明细', question: '下一步应处理什么？', type: 'table', dimensions: ['country'], metrics: ['forecast', 'shipments', 'sellIn', 'sellOut', 'inventory', 'dos', 'targetDos'], confirmed: false },
  ]
}
function normalizeStorylinePlan(candidate: StorylinePlan | undefined, templateId: DashboardPlan['templateId'], businessGoal: string, metrics: MetricDefinition[], charts: ChartSpec[], mapping: DashboardFieldMapping, risks: string[]): StorylinePlan {
  if (candidate && isStorylinePlan(candidate, metrics, charts)) return { ...candidate, source: 'model' }
  const metricIds = metrics.map(metric => metric.id)
  const chartIds = charts.map(chart => chart.id)
  const overview: StorylinePlan['pages'][number] = { id: 'overview', title: templateId === 'sku-operations-v1' ? '库存与销售概览' : '核心表现', readerQuestion: businessGoal, purpose: 'overview', inclusionReason: '先用可计算的核心指标和趋势建立共同语境。', modules: [
    { id: 'headline', component: 'kpi-strip' as const, title: '关键指标', question: '当前整体表现如何？', metricIds: metricIds.slice(0, 6), inclusionReason: '仅展示已映射且可计算的核心指标。' },
    { id: 'trend', component: 'chart' as const, title: charts.find(chart => chart.id === 'trend')?.title ?? '趋势', question: charts.find(chart => chart.id === 'trend')?.question ?? '核心指标如何变化？', chartIds: chartIds.includes('trend') ? ['trend'] : [], inclusionReason: '时间字段存在时用于观察变化。' },
    { id: 'evidence', component: 'diagnostic' as const, title: '数据洞察', question: '当前最需要关注的事实是什么？', inclusionReason: '仅呈现由当前映射数据计算出的快照、集中度和目标差异。' },
  ] }
  const pages: StorylinePlan['pages'] = [overview]
  if (templateId === 'sku-operations-v1' && mapping.item) pages.push({ id: 'sku-diagnostic', title: 'SKU 结构与诊断', readerQuestion: '哪些 SKU 或市场需要优先核查？', purpose: 'diagnostic', inclusionReason: '数据具备 SKU 维度，可将总体变化定位到具体对象。', modules: [
    { id: 'sku-structure', component: 'chart', title: 'SKU 库存结构', question: '库存集中在哪些 SKU？', chartIds: chartIds.filter(id => id === 'skuInventory' || id === 'dosComparison'), inclusionReason: '按 SKU 聚合的库存与 DOS 对比。' },
    { id: 'sku-detail', component: 'table', title: 'SKU 明细', question: '下一步该核查哪些记录？', chartIds: chartIds.includes('detail') ? ['detail'] : [], inclusionReason: '保留可筛选明细，支持进一步确认。' },
  ] })
  const omittedCapabilities = [
    ...(mapping.targetDos ? [] : [{ capability: '目标对比', reason: '未映射目标 DOS 或阈值字段。' }]),
    { capability: '情景模拟', reason: '数据中没有经过用户确认的可编辑假设和结果公式；不生成虚拟模拟。' },
    { capability: '任务流转', reason: '当前 CSV 未包含责任人、状态或任务系统连接。' },
  ]
  return { schemaVersion: 'storyline-plan/v1', source: 'rules', primaryQuestion: businessGoal, narrative: pages.map(page => `${page.title}：${page.readerQuestion}`), pages, omittedCapabilities, assumptionsAndRisks: risks }
}

function isStorylinePlan(value: unknown, metrics: MetricDefinition[], charts: ChartSpec[]): value is StorylinePlan {
  if (!value || typeof value !== 'object') return false
  const plan = value as Partial<StorylinePlan>
  if (plan.schemaVersion !== 'storyline-plan/v1' || !Array.isArray(plan.pages) || !plan.pages.length || plan.pages.length > 5 || !Array.isArray(plan.narrative) || !Array.isArray(plan.omittedCapabilities) || !Array.isArray(plan.assumptionsAndRisks)) return false
  const metricIds = new Set(metrics.map(metric => metric.id)); const chartIds = new Set(charts.map(chart => chart.id)); const pageIds = new Set<string>()
  return plan.pages.every(page => {
    if (!page || typeof page !== 'object') return false
    const current = page as StorylinePlan['pages'][number]
    if (typeof current.id !== 'string' || !current.id || pageIds.has(current.id) || typeof current.title !== 'string' || typeof current.readerQuestion !== 'string' || !Array.isArray(current.modules) || !current.modules.length) return false
    pageIds.add(current.id)
    return current.modules.every(module => module && typeof module.id === 'string' && ['kpi-strip', 'chart', 'diagnostic', 'table', 'actions'].includes(module.component) && (!module.metricIds || module.metricIds.every(id => metricIds.has(id))) && (!module.chartIds || module.chartIds.every(id => chartIds.has(id))))
  })
}
