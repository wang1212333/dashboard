import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { confirmDashboardPlan, isDashboardSpec, planFromAnalysis } from './dashboard-agent/workflow.js'
import type { DashboardPlan, DashboardPlanConfirmation, DashboardSpec } from './dashboard-agent/contracts.js'
import { buildDashboardFromCsv } from './dashboard-build/build.js'
import { listDashboardTemplates } from './dashboard-build/templates.js'
import type { DashboardVisualContract } from './dashboard-build/universal-contract.js'
import { assessOpenMetadataEvidence, normalizeSemanticEvidenceInput } from './data-connectors/openmetadata-mcp.js'
import type { SemanticContext } from './data-connectors/openmetadata-mcp.js'
import { analyzeCsv, type DashboardFieldMapping } from './data-ingestion/csv-profile.js'
import { assertCsvMatchesSnapshot, assertLatestPeriodComplete, assertSkuMetricSemantics, snapshotCsvSource, type CsvSourceSnapshot } from './data-ingestion/source-integrity.js'

const renderJson = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
const asObject = (value: unknown): Record<string, JsonValue> => JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>

/**
 * The complete MVP orchestration surface.  No database, artifact lifecycle,
 * preview/release state, browser UI, or source file path is exposed here.
 */
export function registerDashboardTools(ctx: Context): void {
  // A source is bound only for the live Plan → Confirm → Build conversation.
  // The model receives integrity facts, never a local path or a substitute CSV.
  const boundSources = new Map<string, { csv: string; snapshot: CsvSourceSnapshot }>()

  ctx.tools.register(defineTool({
    name: 'dashboard_analyze_dataset',
    description: 'Step 2: profile a CSV before planning. Returns fields, types, data examples, quality signals, and template recommendations. It does not create a dashboard.',
    parameters: { csv: { type: 'string', required: true, description: 'Complete CSV content. Do not send samples, credentials, or unrelated private text.' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => asObject(analyzeCsv(args.csv)),
    presentCall: () => ({ card: 'generic', title: 'Analyze dashboard dataset', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'dashboard_assess_semantic_evidence',
    description: 'Step 3: turn OpenMetadata search and entity-detail evidence into a reusable semantic context. Call the native OMD search/detail tools first; this tool validates only the selected evidence.',
    parameters: { evidence: { type: 'object', required: true, additionalProperties: true, description: 'OMD assets, definitions/glossary terms, and the native evidence tools used. Never include tokens, SQL, or connection details.' } },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => asObject(assessOpenMetadataEvidence(normalizeSemanticEvidenceInput(args.evidence))),
    presentCall: () => ({ card: 'generic', title: 'Validate semantic evidence', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'dashboard_create_plan',
    description: 'Steps 1–4: create a reviewable plan from complete CSV data, the decision intent, optional OMD context, and an optional bounded visual/storyline contract. It proposes field mapping, metrics, filters, template, and data-driven story line. Only business intent and story line need user confirmation.',
    parameters: {
      csv: { type: 'string', required: true, description: 'Complete CSV content used for both planning and later build.' },
      planId: { type: 'string', required: true, description: 'Temporary identifier for this single plan and its bound source.' },
      businessGoal: { type: 'string', required: true, description: 'Decision problem the dashboard must support.' },
      title: { type: 'string', description: 'User-facing dashboard title.' },
      audience: { type: 'array', items: { type: 'string' }, description: 'Decision makers or operators.' },
      decisions: { type: 'array', items: { type: 'string' }, description: 'Decisions the viewer must be able to make.' },
      semanticContext: { type: 'object', additionalProperties: true, description: 'Context returned by dashboard_assess_semantic_evidence; omit only when OMD is unavailable.' },
      visualContract: { type: 'object', additionalProperties: true, description: 'Safe renderer-owned style tokens; never CSS, HTML, URLs, or scripts.' },
      templateId: { type: 'string', enum: ['content-ops-v1', 'finance-pnl-v1', 'supply-sales-v1', 'sku-operations-v1'], description: 'Optional supported template chosen after analysis.' },
      mapping: { type: 'object', additionalProperties: true, description: 'Optional role-to-column proposal. Omit to use the data-backed recommendation.' },
      storylinePlan: { type: 'object', additionalProperties: true, description: 'Optional bounded arrangement of existing metric/chart ids only. It cannot add formulas, thresholds, actions, HTML, or scripts.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => {
      const analysis = analyzeCsv(args.csv)
      const source = snapshotCsvSource(args.csv)
      const existing = boundSources.get(args.planId)
      if (existing && existing.snapshot.sha256 !== source.sha256) throw new Error('DASHBOARD_PLAN_ID_SOURCE_CONFLICT')
      const plan = planFromAnalysis(analysis, {
        planId: args.planId,
        source,
        businessGoal: args.businessGoal,
        title: args.title,
        audience: Array.isArray(args.audience) ? args.audience.filter((value): value is string => typeof value === 'string') : undefined,
        decisions: Array.isArray(args.decisions) ? args.decisions.filter((value): value is string => typeof value === 'string') : undefined,
        semanticContext: args.semanticContext as SemanticContext | undefined,
        visualContract: args.visualContract as DashboardVisualContract | undefined,
        templateId: args.templateId as DashboardPlan['templateId'] | undefined,
        mapping: args.mapping as DashboardFieldMapping | undefined,
        storylinePlan: args.storylinePlan as DashboardPlan['storylinePlan'] | undefined,
      })
      boundSources.set(plan.planId, { csv: args.csv, snapshot: source })
      return asObject({ plan, source, analysis: { rowCount: analysis.rowCount, fields: analysis.fields, recommendations: analysis.recommendations } })
    },
    presentCall: () => ({ card: 'generic', title: 'Create dashboard plan', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'dashboard_confirm_plan',
    description: 'Step 4: convert a plan to a buildable specification only after the user has confirmed both business intent and the complete story line. Do not infer confirmation.',
    parameters: {
      plan: { type: 'object', required: true, additionalProperties: true, description: 'Exact plan returned by dashboard_create_plan.' },
      confirmation: { type: 'object', required: true, additionalProperties: true, description: 'Exact form: { businessConfirmed: true, storylineConfirmed: true }.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => asObject(confirmDashboardPlan(args.plan as unknown as DashboardPlan, args.confirmation as unknown as DashboardPlanConfirmation)),
    presentCall: () => ({ card: 'generic', title: 'Confirm dashboard intent and story line', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'dashboard_list_templates',
    description: 'List the renderer data contracts currently supported by this minimal dashboard plugin.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async () => asObject({ templates: listDashboardTemplates() }),
    presentCall: () => ({ card: 'generic', title: 'List dashboard templates', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'dashboard_build_html',
    description: 'Step 5: generate the final standalone HTML from a confirmed specification. Uses only the exact source bound to the plan; verifies fingerprint, latest-period completeness, and known SKU semantic mappings before rendering. No preview, release, or version confirmation exists in this MVP.',
    parameters: {
      spec: { type: 'object', required: true, additionalProperties: true, description: 'Exact confirmed specification returned by dashboard_confirm_plan.' },
      sourceLabel: { type: 'string', description: 'Optional business-readable source label; never a file path or server name.' },
      privateTerms: { type: 'array', items: { type: 'string' }, description: 'Terms that must not appear in exported HTML.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => {
      const candidate = args.spec as unknown
      if (!isDashboardSpec(candidate)) throw new Error('DASHBOARD_SPEC_NOT_CONFIRMED')
      const spec: DashboardSpec = candidate
      const bound = boundSources.get(spec.planId)
      if (!bound) throw new Error('DASHBOARD_SOURCE_NOT_BOUND_TO_PLAN')
      assertCsvMatchesSnapshot(bound.csv, spec.source)
      assertLatestPeriodComplete(bound.csv, spec.mapping.period ?? spec.mapping.date)
      assertSkuMetricSemantics(bound.csv, spec.mapping)
      const result = buildDashboardFromCsv(bound.csv, {
        templateId: spec.templateId,
        displayName: spec.title,
        mapping: spec.mapping,
        spec,
        sourceLabel: args.sourceLabel,
        privateTerms: Array.isArray(args.privateTerms) ? args.privateTerms.filter((value): value is string => typeof value === 'string') : undefined,
      })
      return asObject({ title: spec.title, source: spec.source, quality: result.quality, model: result.model, html: result.html })
    },
    presentCall: () => ({ card: 'generic', title: 'Build verified dashboard HTML', kind: 'execute' }),
  }))
}
