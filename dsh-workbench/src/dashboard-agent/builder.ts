import { buildDashboardFromCsv, type BuildDashboardOptions } from '../dashboard-build/build.js'
import type { DashboardBuildResult } from '../dashboard-build/contracts.js'
import type { DashboardSpec } from './contracts.js'
import { isDashboardSpec } from './workflow.js'
import { assertCsvMatchesSnapshot, assertLatestPeriodComplete, assertSkuMetricSemantics } from '../data-ingestion/source-integrity.js'

/**
 * Controlled bridge from an approved Agent plan to the existing deterministic
 * renderers. The model never supplies HTML, JavaScript, or an executable query.
 */
export function buildDashboardFromSpec(csv: string, assetId: string, spec: DashboardSpec, options: Pick<BuildDashboardOptions, 'sourceLabel' | 'privateTerms' | 'previousManifest'> = {}): DashboardBuildResult {
  if (!isDashboardSpec(spec)) throw new Error('DASHBOARD_SPEC_NOT_CONFIRMED')
  assertCsvMatchesSnapshot(csv, spec.source)
  assertLatestPeriodComplete(csv, spec.mapping.period)
  if (spec.templateId === 'sku-operations-v1') assertSkuMetricSemantics(csv, spec.mapping)
  return buildDashboardFromCsv(csv, {
    ...options,
    assetId,
    displayName: spec.title,
    templateId: spec.templateId,
    mapping: spec.mapping,
    spec,
  })
}
