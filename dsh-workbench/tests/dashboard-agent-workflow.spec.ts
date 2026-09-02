import { describe, expect, it } from 'vitest'
import { buildDashboardFromSpec } from '../src/dashboard-agent/builder.js'
import { confirmDashboardPlan, planFromAnalysis } from '../src/dashboard-agent/workflow.js'
import { analyzeCsv } from '../src/data-ingestion/csv-profile.js'
import { assessOpenMetadataEvidence } from '../src/data-connectors/openmetadata-mcp.js'
import { normalizeSemanticEvidenceInput } from '../src/data-connectors/openmetadata-mcp.js'
import { defaultDashboardVisualContract } from '../src/dashboard-build/universal-contract.js'
import { createFileOnlyGovernance } from '../src/dashboard-policy/file-governance.js'
import { assessDashboardGovernance } from '../src/dashboard-policy/governance.js'
import { snapshotCsvSource } from '../src/data-ingestion/source-integrity.js'

const csv = `date,category,planned,published,views,conversions,revenue
2026-08-24,种草内容,2,2,1000,50,1000
2026-08-25,教程内容,2,1,500,10,300`

const supplyCsv = `period,country,forecast,shipments,sellIn,sellOut,inventory,dos
2026-08-24,肯尼亚,100,80,70,60,120,30
2026-08-31,肯尼亚,120,100,90,80,110,25`

const skuCsv = `period,item,region,inventory,sellOut,dos,targetDos
2026-08-24,A,东非,120,60,30,21
2026-08-31,A,东非,110,80,25,21
2026-08-31,B,西非,90,40,45,28`

function plan() {
  return planFromAnalysis(analyzeCsv(csv), {
    planId: 'plan-content-001', businessGoal: '识别内容运营表现并安排优化行动', templateId: 'content-ops-v1', source: snapshotCsvSource(csv),
    mapping: { date: 'date', category: 'category', planned: 'planned', published: 'published', views: 'views', conversions: 'conversions', revenue: 'revenue' },
  })
}

describe('structured dashboard agent workflow', () => {
  it('keeps proposed business semantics unconfirmed until the user explicitly approves them', () => {
    const proposal = plan()
    expect(proposal).toMatchObject({ schemaVersion: 'dashboard-plan/v1', status: 'needs_confirmation', intent: { businessGoal: '识别内容运营表现并安排优化行动' } })
    expect(proposal.metrics.every(metric => !metric.confirmed)).toBe(true)
    expect(proposal.charts.every(chart => !chart.confirmed)).toBe(true)
    expect(() => confirmDashboardPlan(proposal, { businessConfirmed: false, storylineConfirmed: false })).toThrow('BUSINESS_CONFIRMATION_REQUIRED')
  })

  it('requires confirmation of the business intent and story line before building a DashboardSpec', () => {
    const proposal = plan()
    expect(() => confirmDashboardPlan(proposal, { businessConfirmed: true } as never)).toThrow('STORYLINE_CONFIRMATION_REQUIRED')
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    expect(spec).toMatchObject({ schemaVersion: 'dashboard-spec/v1', templateId: 'content-ops-v1', title: '内容运营看板' })
    expect(spec.metrics.every(metric => metric.confirmed)).toBe(true)
    const dashboard = buildDashboardFromSpec(csv, 'content-agent-dashboard', spec)
    expect(dashboard.manifest.spec).toEqual(spec)
    expect(dashboard.model).toMatchObject({ kind: 'spec-driven-v1', title: '内容运营看板' })
    expect(dashboard.html).toContain('内容运营看板')
    expect(dashboard.html).not.toContain('库存加权 DOS')
  })

  it('persists verified OpenMetadata context into the Plan and confirmed Spec', () => {
    const semanticContext = assessOpenMetadataEvidence({
      question: '内容浏览量和转化率应采用哪些业务定义？', requestedMetrics: ['浏览量', '转化率'],
      selectedAssets: [{ fqn: 'mysql.cdp.content_daily', entityType: 'table', description: '内容日粒度指标汇总', glossaryTerms: ['浏览量', '转化率'], evidenceTools: ['semantic_search', 'get_entity_details'] }],
    }).context
    const proposal = planFromAnalysis(analyzeCsv(csv), {
      planId: 'plan-content-semantic-001', businessGoal: '识别内容运营表现并安排优化行动', templateId: 'content-ops-v1', source: snapshotCsvSource(csv),
      mapping: { date: 'date', category: 'category', planned: 'planned', published: 'published', views: 'views', conversions: 'conversions', revenue: 'revenue' }, semanticContext,
    })
    expect(proposal.semanticContext.status).toBe('verified')
    expect(proposal.metrics.every(metric => metric.semanticEvidenceSourceIds.includes('openmetadata:mysql.cdp.content_daily'))).toBe(true)
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    expect(spec.semanticContext).toEqual(semanticContext)
  })

  it('uses data validation when an incomplete semantic lookup leaves no mapping ambiguity', () => {
    const semanticContext = assessOpenMetadataEvidence({
      question: '内容浏览量如何定义？', selectedAssets: [{ fqn: 'mysql.cdp.content_daily', entityType: 'table', description: '内容日粒度指标汇总', evidenceTools: ['semantic_search'] }],
    }).context
    const proposal = planFromAnalysis(analyzeCsv(csv), {
      planId: 'plan-content-semantic-incomplete', businessGoal: '识别内容运营表现', templateId: 'content-ops-v1', source: snapshotCsvSource(csv),
      mapping: { date: 'date', category: 'category', planned: 'planned', published: 'published', views: 'views', conversions: 'conversions', revenue: 'revenue' }, semanticContext,
    })
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    expect(spec.semanticContext.status).toBe('incomplete')
    expect(proposal.confirmationState.mappingRolesNeedingReview).toEqual([])
  })

  it('keeps the data-derived field proposal when OMD remains incomplete', () => {
    const ambiguousCsv = `period,item,inventory,total_dos,channel_dos\n2026-08-24,A,100,20,21\n2026-08-31,A,90,18,19`
    const semanticContext = assessOpenMetadataEvidence({
      question: 'SKU DOS 应采用哪个字段？', selectedAssets: [{ fqn: 'warehouse.inventory_snapshot', entityType: 'table', description: '库存快照', evidenceTools: ['semantic_search'] }],
    }).context
    const proposal = planFromAnalysis(analyzeCsv(ambiguousCsv), {
      planId: 'plan-sku-semantic-incomplete', businessGoal: '识别 SKU 库存风险', templateId: 'sku-operations-v1', semanticContext, source: snapshotCsvSource(ambiguousCsv),
      mapping: { period: 'period', item: 'item', inventory: 'inventory', dos: 'total_dos' },
    })
    expect(proposal.confirmationState.mappingRolesNeedingReview).toContain('dos')
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    expect(spec.mapping.dos).toBe('total_dos')
    expect(spec.semanticContext.status).toBe('incomplete')
  })

  it('persists a selected visual contract and lets the deterministic renderer consume it', () => {
    const base = defaultDashboardVisualContract()
    const visualContract = {
      ...base, designTemplateId: 'clickhouse',
      palette: { ...base.palette, canvas: '#0a0a0a', surface: '#1a1a1a', elevated: '#242424', primary: '#faff69', primaryText: '#0a0a0a', text: '#ffffff', muted: '#cccccc', hairline: '#2a2a2a', success: '#00aa77', warning: '#ffb000', danger: '#ee4455' },
    }
    const proposal = planFromAnalysis(analyzeCsv(csv), {
      planId: 'plan-content-clickhouse-001', businessGoal: '识别内容运营表现', templateId: 'content-ops-v1', visualContract, source: snapshotCsvSource(csv),
      mapping: { date: 'date', category: 'category', planned: 'planned', published: 'published', views: 'views', conversions: 'conversions', revenue: 'revenue' },
    })
    expect(proposal.informationArchitecture.sections).toContain('trust')
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    const dashboard = buildDashboardFromSpec(csv, 'content-clickhouse-dashboard', spec)
    expect(spec.visualContract.designTemplateId).toBe('clickhouse')
    expect(dashboard.html).toContain('--canvas:#0a0a0a')
    expect(dashboard.html).toContain('data-dashboard-role="trust"')
  })

  it('normalizes legacy semantic-evidence aliases before strict validation', () => {
    const assessment = assessOpenMetadataEvidence(normalizeSemanticEvidenceInput({
      question: '库存周转天数如何定义？',
      assets: [{
        fullyQualifiedName: 'warehouse.inventory_turnover', entityType: 'table', definition: '国家库存周转天数快照',
        evidenceTools: ['mcp__openmetadata_semantic__semantic_search', 'mcp__openmetadata_semantic__get_entity_details'],
      }],
    }))
    expect(assessment).toMatchObject({ valid: true, context: { status: 'verified', evidenceSourceIds: ['openmetadata:warehouse.inventory_turnover'] } })
  })

  it('accepts the legacy evidenceToolsUsed field emitted by earlier agents', () => {
    const assessment = assessOpenMetadataEvidence(normalizeSemanticEvidenceInput({
      question: '库存周转天数如何定义？',
      adoptedAssets: [{
        fullyQualifiedName: 'warehouse.inventory_turnover', entityType: 'table', definition: '国家库存周转天数快照',
        evidenceToolsUsed: ['mcp__openmetadata_semantic__semantic_search', 'mcp__openmetadata_semantic__get_entity_details'],
      }],
    }))
    expect(assessment).toMatchObject({ valid: true, context: { status: 'verified', evidenceSourceIds: ['openmetadata:warehouse.inventory_turnover'] } })
  })

  it('uses actual supply-sales fields in a confirmed plan and derives file governance without model-authored low-level payloads', () => {
    const proposal = planFromAnalysis(analyzeCsv(supplyCsv), {
      planId: 'plan-supply-001', businessGoal: '监控国家库存与产销节奏', templateId: 'supply-sales-v1', source: snapshotCsvSource(supplyCsv),
      mapping: { period: 'period', country: 'country', forecast: 'forecast', shipments: 'shipments', sellIn: 'sellIn', sellOut: 'sellOut', inventory: 'inventory', dos: 'dos' },
    })
    expect(proposal.charts.find(chart => chart.id === 'trend')?.metrics).toEqual(['forecast', 'shipments', 'sellOut'])
    expect(proposal.charts.find(chart => chart.id === 'comparison')?.metrics).toEqual(['inventory', 'dos'])
    expect(proposal.metrics.map(metric => metric.id)).toEqual(expect.arrayContaining(['dos', 'targetDos', 'dosCompliance', 'shipmentFulfillment', 'inventoryConcentration']))
    expect(proposal.charts.map(chart => chart.id)).toEqual(expect.arrayContaining(['inventoryShare', 'dosComparison']))
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    expect(assessDashboardGovernance(createFileOnlyGovernance(spec, supplyCsv))).toMatchObject({ valid: true, issues: [] })
  })

  it('keeps field mapping out of the MVP confirmation payload', () => {
    const proposal = planFromAnalysis(analyzeCsv(supplyCsv), {
      planId: 'plan-supply-confirmation-shape', businessGoal: '监控国家库存与产销节奏', templateId: 'supply-sales-v1', source: snapshotCsvSource(supplyCsv),
      mapping: { period: 'period', country: 'country', forecast: 'forecast', shipments: 'shipments', sellIn: 'sellIn', sellOut: 'periodSellOut', inventory: 'inventory', dos: 'totalDos' },
    })
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    expect(spec.mapping).toMatchObject({ sellOut: 'periodSellOut', dos: 'totalDos' })
  })

  it('uses the adaptive SKU template only for data-supported modules after story confirmation', () => {
    const proposal = planFromAnalysis(analyzeCsv(skuCsv), {
      planId: 'plan-sku-001', businessGoal: '定位需要优先处理的 SKU 库存与周转问题', templateId: 'sku-operations-v1', source: snapshotCsvSource(skuCsv),
      mapping: { period: 'period', item: 'item', region: 'region', inventory: 'inventory', sellOut: 'sellOut', dos: 'dos', targetDos: 'targetDos' },
    })
    expect(proposal.storylinePlan.pages.map(page => page.id)).toEqual(['overview', 'sku-diagnostic'])
    expect(proposal.storylinePlan.omittedCapabilities).toEqual(expect.arrayContaining([expect.objectContaining({ capability: '情景模拟' })]))
    const spec = confirmDashboardPlan(proposal, { businessConfirmed: true, storylineConfirmed: true })
    const dashboard = buildDashboardFromSpec(skuCsv, 'adaptive-sku-dashboard', spec)
    expect(dashboard.html).toContain('data-story-page="sku-diagnostic"')
    expect(dashboard.html).toContain('本次未启用的能力')
    expect(dashboard.model.storylinePlan.source).toBe('rules')
  })

  it('returns a readable confirmation error when story confirmation is absent', () => {
    expect(() => confirmDashboardPlan(plan(), { businessConfirmed: true } as never)).toThrow('STORYLINE_CONFIRMATION_REQUIRED')
  })
})
