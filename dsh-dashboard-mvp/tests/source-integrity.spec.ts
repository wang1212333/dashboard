import { describe, expect, it } from 'vitest'
import { analyzeCsv } from '../src/data-ingestion/csv-profile.js'
import { assertCsvMatchesSnapshot, assertLatestPeriodComplete, assertSkuMetricSemantics, snapshotCsvSource } from '../src/data-ingestion/source-integrity.js'
import { confirmDashboardPlan, planFromAnalysis } from '../src/dashboard-agent/workflow.js'
import { buildDashboardFromCsv } from '../src/dashboard-build/build.js'

const skuCsv = `trunover_weekly_date,item,total_stock_qty,total_sell_out,period_sell_out,chnl_dos,total_chnl_dos
2026-07-05,A,100,300,30,20,25
2026-07-05,B,120,340,40,24,29
2026-07-12,A,90,380,35,18,23
2026-07-12,B,110,420,45,22,27`

describe('minimal dashboard safeguards', () => {
  it('binds the final build to the exact complete CSV', () => {
    const source = snapshotCsvSource(skuCsv)
    const plan = planFromAnalysis(analyzeCsv(skuCsv), { planId: 'sku-plan', source, businessGoal: '识别库存健康度风险', templateId: 'sku-operations-v1', mapping: { period: 'trunover_weekly_date', item: 'item', inventory: 'total_stock_qty', sellOut: 'total_sell_out', dos: 'chnl_dos' } })
    const spec = confirmDashboardPlan(plan, { businessConfirmed: true, storylineConfirmed: true })
    expect(() => assertCsvMatchesSnapshot(skuCsv.split('\n').slice(0, 3).join('\n'), spec.source)).toThrow('DASHBOARD_SOURCE_INTEGRITY_MISMATCH')
    expect(buildDashboardFromCsv(skuCsv, { templateId: spec.templateId, mapping: spec.mapping, spec }).html).toContain('<html')
  })

  it('blocks partial latest snapshots and wrong SKU metric semantics', () => {
    const header = skuCsv.split('\n')[0]
    const history = Array.from({ length: 10 }, (_, index) => `2026-07-05,A${index},100,300,30,20,25`).join('\n')
    expect(() => assertLatestPeriodComplete(`${header}\n${history}\n2026-07-19,0,0,0,0,0,0`, 'trunover_weekly_date')).toThrow('DASHBOARD_LATEST_PERIOD_INCOMPLETE')
    expect(() => assertSkuMetricSemantics(skuCsv, { dos: 'total_chnl_dos', sellOut: 'period_sell_out' })).toThrow('DASHBOARD_SEMANTIC_MAPPING_REQUIRED')
    expect(analyzeCsv(skuCsv).recommendations.find(item => item.templateId === 'sku-operations-v1')?.mapping).toMatchObject({ dos: 'chnl_dos', sellOut: 'total_sell_out' })
  })
})
