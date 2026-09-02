import { validateOfflineDashboard } from '../dashboard-export/validator.js'
import type { ContentDashboardModel, DashboardBuildResult, DashboardManifest, DashboardManifestInput } from './contracts.js'
import { parseContentCsv } from './csv.js'
import { createDraftManifest } from './manifest.js'
import { createDashboardModel } from './metrics.js'
import { renderOfflineDashboard } from './render.js'
import { getDashboardTemplate } from './templates.js'
import { mapToContentCsv, type DashboardFieldMapping } from '../data-ingestion/csv-profile.js'
import { buildFinanceDashboardFromCsv } from './finance.js'
import { buildSupplySalesDashboardFromCsv } from './supply-sales.js'
import { isDashboardSpec } from '../dashboard-agent/workflow.js'
import { defaultDashboardVisualContract } from './universal-contract.js'
import { buildSpecDrivenDashboardFromCsv } from './spec-driven.js'

export interface BuildDashboardOptions extends DashboardManifestInput {
  previousManifest?: DashboardManifest
  mapping?: DashboardFieldMapping
}

export function buildDashboardFromCsv(csv: string, options?: BuildDashboardOptions & { templateId?: 'content-ops-v1' }): DashboardBuildResult<ContentDashboardModel>
export function buildDashboardFromCsv(csv: string, options: BuildDashboardOptions): DashboardBuildResult
export function buildDashboardFromCsv(csv: string, options: BuildDashboardOptions = { assetId: 'content-ops-dashboard' }): DashboardBuildResult {
  if (options.spec && !isDashboardSpec(options.spec)) throw new Error('DASHBOARD_SPEC_NOT_CONFIRMED')
  if (options.spec && options.spec.templateId !== options.templateId) throw new Error('DASHBOARD_SPEC_TEMPLATE_MISMATCH')
  if (options.spec && JSON.stringify(options.spec.mapping) !== JSON.stringify(options.mapping)) throw new Error('DASHBOARD_SPEC_MAPPING_MISMATCH')
  if (options.spec) return buildSpecDrivenDashboardFromCsv(csv, options as BuildDashboardOptions & { spec: NonNullable<BuildDashboardOptions['spec']> })
  const template = getDashboardTemplate(options.templateId)
  if (template.id === 'finance-pnl-v1') return buildFinanceDashboardFromCsv(csv, options)
  if (template.id === 'supply-sales-v1') return buildSupplySalesDashboardFromCsv(csv, options)
  const { records, quality } = parseContentCsv(options.mapping ? mapToContentCsv(csv, options.mapping) : csv)
  const model = createDashboardModel(records)
  const html = renderOfflineDashboard(model, { visualContract: defaultDashboardVisualContract(), sourceLabel: options.sourceLabel })
  const validation = validateOfflineDashboard(html, options.privateTerms)
  if (!validation.valid) throw new Error(`DASHBOARD_VALIDATION_FAILED:${validation.issues.join(',')}`)
  return { html, quality, model, manifest: createDraftManifest(options, template, options.previousManifest), template }
}
