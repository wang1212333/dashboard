import { describe, expect, it } from 'vitest'
import { buildDashboardFromCsv } from '../src/dashboard-build/build.js'
import { parseContentCsv } from '../src/dashboard-build/csv.js'

const csv = `date,category,planned,published,views,conversions,revenue
2026-08-17,种草内容,2,2,1000,50,1000
2026-08-18,教程内容,2,1,500,10,300`

describe('CSV to offline dashboard', () => {
  it('computes business metrics and produces a valid offline page', () => {
    const result = buildDashboardFromCsv(csv)
    expect(result.model.kpis.published).toBe(3)
    expect(result.model.kpis.planCompletion).toBe(0.75)
    expect(result.model.kpis.conversionRate).toBe(0.04)
    expect(result.html).toContain('data-dashboard-role="actions"')
    expect(result.quality.validRows).toBe(2)
  })

  it('retains valid rows and reports invalid rows', () => {
    const result = parseContentCsv(`${csv}\n2026-02-31,坏数据,1,1,1,1,1`)
    expect(result.records).toHaveLength(2)
    expect(result.quality.rejectedRows).toEqual([{ row: 4, reason: 'INVALID_DATE' }])
  })

  it('fails early when the contract columns are missing', () => {
    expect(() => buildDashboardFromCsv('date,category\n2026-08-17,种草内容')).toThrow('CSV_COLUMNS_REQUIRED')
  })

  it('creates a revisioned draft manifest and increments a rebuild', () => {
    const initial = buildDashboardFromCsv(csv, { assetId: 'weekly-content', displayName: '内容周报', sourceLabel: '8 月运营记录' })
    expect(initial.manifest).toMatchObject({ assetId: 'weekly-content', revision: 'rev-0001', status: 'draft', templateId: 'content-ops-v1' })
    const rebuild = buildDashboardFromCsv(csv, { assetId: 'weekly-content', previousManifest: initial.manifest })
    expect(rebuild.manifest.revision).toBe('rev-0002')
    expect(rebuild.manifest.createdAt).toBe(initial.manifest.createdAt)
  })

  it('rejects unknown templates before a build begins', () => {
    expect(() => buildDashboardFromCsv(csv, { assetId: 'weekly-content', templateId: 'sales-v1' })).toThrow('DASHBOARD_TEMPLATE_NOT_FOUND')
  })
})
