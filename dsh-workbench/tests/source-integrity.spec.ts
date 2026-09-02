import { describe, expect, it } from 'vitest'
import { assertCsvMatchesSnapshot, assertLatestPeriodComplete, assertSkuMetricSemantics, snapshotCsvSource } from '../src/data-ingestion/source-integrity.js'
import { analyzeCsv } from '../src/data-ingestion/csv-profile.js'
import { planFromAnalysis, confirmDashboardPlan } from '../src/dashboard-agent/workflow.js'
import { buildDashboardFromSpec } from '../src/dashboard-agent/builder.js'

const completeSkuCsv = `trunover_weekly_date,item,total_stock_qty,total_sell_out,period_sell_out,chnl_dos,total_chnl_dos
2026-07-05,A,100,300,30,20,25
2026-07-05,B,120,340,40,24,29
2026-07-12,A,90,380,35,18,23
2026-07-12,B,110,420,45,22,27`

describe('dashboard source integrity', () => {
  it('rejects a sampled or modified CSV after a plan is created', () => {
    const snapshot = snapshotCsvSource(completeSkuCsv)
    expect(() => assertCsvMatchesSnapshot(completeSkuCsv.split('\n').slice(0, 3).join('\n'), snapshot)).toThrow('DASHBOARD_SOURCE_INTEGRITY_MISMATCH')
  })

  it('rejects a one-row late partition as the latest inventory snapshot', () => {
    const header = completeSkuCsv.split('\n')[0]
    const historical = Array.from({ length: 10 }, (_, index) => `2026-07-05,A${index},100,300,30,20,25`).join('\n')
    const partialLatest = `${header}\n${historical}\n2026-07-19,0,0,0,0,0,0`
    expect(() => assertLatestPeriodComplete(partialLatest, 'trunover_weekly_date')).toThrow('DASHBOARD_LATEST_PERIOD_INCOMPLETE:2026-07-19:1/10')
  })

  it('protects canonical SKU DOS and cumulative sell-out mappings when both fields exist', () => {
    expect(() => assertSkuMetricSemantics(completeSkuCsv, { dos: 'total_chnl_dos', sellOut: 'period_sell_out' })).toThrow('DASHBOARD_SEMANTIC_MAPPING_REQUIRED:dos=chnl_dos')
    expect(() => assertSkuMetricSemantics(completeSkuCsv, { dos: 'chnl_dos', sellOut: 'period_sell_out' })).toThrow('DASHBOARD_SEMANTIC_MAPPING_REQUIRED:sellOut=total_sell_out')
    expect(() => assertSkuMetricSemantics(completeSkuCsv, { dos: 'chnl_dos', sellOut: 'total_sell_out' })).not.toThrow()
  })

  it('prefers explicit cumulative sell-out and channel DOS over header order', () => {
    const recommendation = analyzeCsv(completeSkuCsv).recommendations.find(item => item.templateId === 'sku-operations-v1')
    expect(recommendation?.mapping).toMatchObject({ sellOut: 'total_sell_out', dos: 'chnl_dos' })
  })

  it('makes the confirmed builder fail closed when it receives a different source', () => {
    const plan = planFromAnalysis(analyzeCsv(completeSkuCsv), {
      planId: 'bound-source-test', source: snapshotCsvSource(completeSkuCsv), businessGoal: '识别 SKU 库存风险', templateId: 'sku-operations-v1',
      mapping: { period: 'trunover_weekly_date', item: 'item', inventory: 'total_stock_qty', sellOut: 'total_sell_out', dos: 'chnl_dos' },
    })
    const spec = confirmDashboardPlan(plan, { businessConfirmed: true, storylineConfirmed: true })
    expect(() => buildDashboardFromSpec(completeSkuCsv.split('\n').slice(0, 3).join('\n'), 'source-bound-dashboard', spec)).toThrow('DASHBOARD_SOURCE_INTEGRITY_MISMATCH')
  })
})
