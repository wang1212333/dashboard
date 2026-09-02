import { describe, expect, it } from 'vitest'
import { analyzeCsv } from '../src/data-ingestion/csv-profile.js'
import { buildDashboardFromCsv } from '../src/dashboard-build/build.js'

const financeCsv = `会计期间,部门,营业收入,营业成本,净利润
2026-01,华东,100000,70000,30000
2026-02,华东,120000,82000,38000
2026-01,华南,80000,60000,20000`

describe('financial dashboard mapping', () => {
  it('profiles Chinese financial headers and recommends a financial template', () => {
    const analysis = analyzeCsv(financeCsv)
    expect(analysis.recommendations[0]).toMatchObject({ templateId: 'finance-pnl-v1', mapping: { period: '会计期间', revenue: '营业收入', cost: '营业成本', profit: '净利润' } })
    expect(analysis.fields.find((field) => field.name === '营业收入')).toMatchObject({ inferredType: 'number' })
  })

  it('builds a validated finance P&L dashboard from confirmed mapping', () => {
    const result = buildDashboardFromCsv(financeCsv, { assetId: 'finance-pnl', templateId: 'finance-pnl-v1', mapping: { period: '会计期间', dimension: '部门', revenue: '营业收入', cost: '营业成本', profit: '净利润' } })
    expect(result.manifest).toMatchObject({ templateId: 'finance-pnl-v1', dataContract: 'finance-pnl-v1' })
    expect(result.model).toMatchObject({ kind: 'finance-pnl-v1', kpis: { revenue: 300000, cost: 212000, profit: 88000 } })
    expect(result.html).toContain('data-dashboard-role="trend"')
  })
})
