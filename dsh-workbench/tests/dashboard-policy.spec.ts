import { describe, expect, it } from 'vitest'
import { validateMetricContract } from '../src/dashboard-policy/metric-contract.js'
import { reconcileDatasets } from '../src/dashboard-policy/reconciliation.js'
import { decideOperatingMode } from '../src/dashboard-policy/source-routing.js'
import { assessDashboardGovernance } from '../src/dashboard-policy/governance.js'

describe('dashboard policy', () => {
  it('requires a real query and metadata once a product is confirmed', () => {
    const result = decideOperatingMode({ confirmedProduct: true, sources: [{ id: 'file', kind: 'file', businessRole: 'plan', usable: true, contributions: ['comparison'] }] })
    expect(result.mode).toBe('dual-source')
    expect(result.issues).toEqual(expect.arrayContaining(['QUERY_BUSINESS_EVIDENCE_REQUIRED', 'METADATA_EVIDENCE_REQUIRED']))
  })

  it('rejects an unsupported metric card', () => {
    expect(validateMetricContract({ label: '成交额', definition: '', unit: '元', direction: 'higher-is-better', grain: '天', timeframe: { start: '2026-08-31', end: '2026-08-01', timezone: 'Asia/Shanghai' }, comparison: 'target', evidenceSourceIds: [] }))
      .toEqual(expect.arrayContaining(['METRIC_DEFINITION_REQUIRED', 'METRIC_TIMEFRAME_INVALID', 'METRIC_EVIDENCE_REQUIRED']))
  })

  it('does not silently reconcile conflicting actuals', () => {
    const issues = reconcileDatasets([
      { id: 'a', metricLabel: '销售额', role: 'actual', unit: '元', grain: '天', timeframe: '2026-08', value: 100 },
      { id: 'b', metricLabel: '销售额', role: 'actual', unit: '元', grain: '天', timeframe: '2026-08', value: 120 },
    ], [])
    expect(issues).toContain('ACTUAL_VALUE_CONFLICT')
  })

  it('blocks a Draft until the business proposal and all decision sections are supported', () => {
    const result = assessDashboardGovernance({
      routing: { confirmedProduct: false, sources: [{ id: 'plan', kind: 'file', businessRole: 'target', usable: true, contributions: ['comparison'] }] },
      metrics: [], datasets: [], relationships: [], components: ['kpi'], businessConfirmed: false,
    })
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining(['BUSINESS_CONFIRMATION_REQUIRED', 'KPI_COUNT_MUST_BE_3_OR_4', 'TREND_OR_COMPARISON_REQUIRED', 'DIAGNOSTIC_REQUIRED', 'ACTION_REQUIRED']))
  })

  it('requires verified values and a material contribution from every dual-source branch', () => {
    const result = decideOperatingMode({
      confirmedProduct: true,
      sources: [
        { id: 'file', kind: 'file', businessRole: 'plan', usable: true, contributions: [] },
        { id: 'metadata', kind: 'metadata', businessRole: 'definition', usable: true, contributions: [], metadataVerified: true },
        { id: 'query', kind: 'query', businessRole: 'actual', usable: true, contributions: ['kpi'] },
      ],
    })
    expect(result.mode).toBe('dual-source')
    expect(result.issues).toEqual(expect.arrayContaining(['QUERY_BUSINESS_EVIDENCE_REQUIRED', 'SOURCE_CONTRIBUTION_REQUIRED:file']))
  })
})
