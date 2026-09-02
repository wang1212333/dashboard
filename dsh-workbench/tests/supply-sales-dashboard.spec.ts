import { describe, expect, it } from 'vitest'
import { analyzeCsv } from '../src/data-ingestion/csv-profile.js'
import { buildDashboardFromCsv } from '../src/dashboard-build/build.js'

const supplyCsv = `统计月份,国家名称,DRP2销售版,SAP发货数量,SI,SO,全渠道库存,渠道DOS
202601,印度尼西亚,1000,800,750,600,1200,30
202602,印度尼西亚,1200,1000,900,800,1100,25
202601,EE1,500,400,300,260,900,45`

const enrichedSupplyCsv = `period,country,region,forecast,shipments,sellIn,sellOut,inventory,dos,targetDos
2026-07-19,肯尼亚,东非,1000,800,750,600,1200,30,35
2026-07-19,坦桑尼亚,东非,800,700,600,550,900,48,35
2026-07-19,印度,南亚,1500,1400,1200,1300,1600,28,30`

describe('supply-sales dashboard mapping', () => {
  it('recommends supply-sales for a sales and inventory dataset', () => {
    const analysis = analyzeCsv(supplyCsv)
    expect(analysis.recommendations[0]).toMatchObject({ templateId: 'supply-sales-v1', mapping: { period: '统计月份', country: '国家名称', forecast: 'DRP2销售版', shipments: 'SAP发货数量', sellIn: 'SI', sellOut: 'SO', inventory: '全渠道库存', dos: '渠道DOS' } })
  })

  it('builds a validated dashboard from confirmed supply-sales mapping', () => {
    const result = buildDashboardFromCsv(supplyCsv, { assetId: 'supply-sales', templateId: 'supply-sales-v1', mapping: { period: '统计月份', country: '国家名称', forecast: 'DRP2销售版', shipments: 'SAP发货数量', sellIn: 'SI', sellOut: 'SO', inventory: '全渠道库存', dos: '渠道DOS' } })
    expect(result.manifest).toMatchObject({ templateId: 'supply-sales-v1', dataContract: 'supply-sales-v1' })
    expect(result.model).toMatchObject({ kind: 'supply-sales-v1', snapshotPeriod: '202602', kpis: { forecast: 2700, shipments: 2200, sellOut: 1660, inventory: 1100 } })
    expect(result.html).toContain('产销协同驾驶舱')
  })

  it('renders region, target-DOS, concentration, and DOS-comparison components when the mapped fields exist', () => {
    const result = buildDashboardFromCsv(enrichedSupplyCsv, {
      assetId: 'supply-sales-enriched', templateId: 'supply-sales-v1',
      mapping: { period: 'period', country: 'country', region: 'region', forecast: 'forecast', shipments: 'shipments', sellIn: 'sellIn', sellOut: 'sellOut', inventory: 'inventory', dos: 'dos', targetDos: 'targetDos' },
    })
    expect(result.model).toMatchObject({ kpis: { targetDos: expect.any(Number), dosToTarget: expect.any(Number), shipmentFulfillment: expect.any(Number), inventoryConcentration: expect.any(Number) }, regions: [{ region: '东非' }, { region: '南亚' }] })
    expect(result.html).toContain('地区库存占比')
    expect(result.html).toContain('DOS 与目标对比')
    expect(result.html).toContain('库存集中度（Top 5）')
  })
})
