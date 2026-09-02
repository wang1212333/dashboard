import { describe, expect, it } from 'vitest'
import { validateOfflineDashboard } from '../src/dashboard-export/validator.js'

const completeHtml = `<!doctype html><html><body><header data-dashboard-role="summary" data-freshness="2026-08-27T12:00:00+08:00"></header><main>
<section data-dashboard-role="filters"></section><article data-dashboard-role="kpi"></article><article data-dashboard-role="kpi"></article><article data-dashboard-role="kpi"></article>
<section data-dashboard-role="trend"></section><section data-dashboard-role="diagnostic"></section><section data-dashboard-role="actions"></section><section data-dashboard-role="detail"></section><section data-dashboard-role="trust"></section></main></body></html>`

describe('offline dashboard export validator', () => {
  it('accepts the required decision structure', () => expect(validateOfflineDashboard(completeHtml)).toEqual({ valid: true, issues: [] }))
  it('rejects a network dependency and private identifier', () => {
    const result = validateOfflineDashboard(`${completeHtml}<script src="https://example.com/a.js"></script>`, ['secret_table'])
    expect(result.issues).toContain('EXTERNAL_DEPENDENCY_FORBIDDEN')
    expect(validateOfflineDashboard(`${completeHtml} secret_table`, ['secret_table']).issues).toContain('FORBIDDEN_TERM:secret_table')
  })
  it('requires a business freshness timestamp', () => {
    expect(validateOfflineDashboard(completeHtml.replace(' data-freshness="2026-08-27T12:00:00+08:00"', '')).issues).toContain('FRESHNESS_REQUIRED')
  })
})
