import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { listDashboardTemplates } from './dashboard-build/templates.js'
import { analyzeCsv, type DashboardFieldMapping } from './data-ingestion/csv-profile.js'
import { confirmDashboardPlan, isDashboardSpec, planFromAnalysis } from './dashboard-agent/workflow.js'
import type { DashboardPlan, DashboardPlanConfirmation } from './dashboard-agent/contracts.js'
import { assessOpenMetadataEvidence, normalizeSemanticEvidenceInput } from './data-connectors/openmetadata-mcp.js'
import type { SemanticContext } from './data-connectors/openmetadata-mcp.js'
import type { DashboardVisualContract } from './dashboard-build/universal-contract.js'
import type { KnowledgeLibrary } from './library/knowledge-library.js'
import { assertCsvMatchesSnapshot, assertLatestPeriodComplete, assertSkuMetricSemantics, snapshotCsvSource, type CsvSourceSnapshot } from './data-ingestion/source-integrity.js'

const renderJson = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
/** The DSH ToolRuntime accepts only lossless JSON values; serialize domain records at this boundary. */
const asObject = (value: unknown): Record<string, JsonValue> => JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>

export function registerWorkbenchTools(ctx: Context, library: KnowledgeLibrary): void {
  // The model may propose a plan, but it must never retype, trim, or substitute
  // the source data during the later build call. This registry is per DSH
  // runtime and only exposes a plan id plus non-sensitive integrity facts.
  const boundSources = new Map<string, { csv: string; snapshot: CsvSourceSnapshot }>()
  ctx.tools.register(defineTool({
    name: 'workbench_assess_semantic_evidence',
    description: 'Close the semantic-retrieval phase before planning. Validate OpenMetadata candidates and details, then return a durable semanticContext. The Agent must call native semantic_search or search_metadata first and get_entity_details for each adopted asset. A verified context automatically supports matching fields; an incomplete context is cross-checked against CSV types, completeness, and candidate ambiguity, and blocks confirmation only where ambiguity remains.',
    parameters: {
      evidence: { type: 'object', required: true, additionalProperties: true, description: 'Selected OpenMetadata assets with FQN, definition or glossary terms, and the exact MCP evidence tools used. Do not include access tokens, SQL, or raw connection details.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => asObject(assessOpenMetadataEvidence(normalizeSemanticEvidenceInput(args.evidence))),
    presentCall: () => ({ card: 'generic', title: 'Assess OpenMetadata semantic evidence', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_create_dashboard_plan',
    description: 'Create a reviewable DashboardPlan after data profiling and optional semantic retrieval. It proposes template, field mapping, metrics, filters and a story line. Only the business intent and story line are presented for user confirmation.',
    parameters: {
      csv: { type: 'string', required: true, description: 'CSV content to profile. Never include credentials or unrelated private data.' },
      planId: { type: 'string', required: true, description: 'Temporary id for this single conversational proposal.' },
      businessGoal: { type: 'string', required: true, description: 'Decision problem this dashboard must support.' },
      title: { type: 'string', description: 'Optional user-facing dashboard name.' },
      audience: { type: 'array', items: { type: 'string' }, description: 'Target users or decision makers.' },
      decisions: { type: 'array', items: { type: 'string' }, description: 'Actions users need to make after viewing the dashboard.' },
      semanticContext: { type: 'object', additionalProperties: true, description: 'Optional durable semanticContext returned by workbench_assess_semantic_evidence. Omit only when OpenMetadata is unavailable; the Plan will cross-check available metadata with CSV evidence and explicitly record remaining uncertainty.' },
      visualContract: { type: 'object', additionalProperties: true, description: 'Optional dashboard-visual/v1 contract for the selected design template: id, palette, typography and component tokens. The deterministic renderer validates and consumes these values; never provide CSS, HTML, URLs, or scripts.' },
      templateId: { type: 'string', enum: ['content-ops-v1', 'finance-pnl-v1', 'supply-sales-v1', 'sku-operations-v1'], description: 'Optional template selected after reviewing dataset analysis. sku-operations-v1 uses an evidence-bound, dynamically arranged storyline rather than a fixed inventory page set.' },
      mapping: { type: 'object', additionalProperties: true, description: 'Optional reviewed role-to-column mapping. Omit to use the most likely candidate as an unconfirmed proposal.' },
      storylinePlan: { type: 'object', additionalProperties: true, description: 'Optional bounded storyline-plan/v1 proposed from the user question and profile. It may only arrange metric/chart ids already present in the plan; it may not add formulas, thresholds, actions, HTML, or scripts.' },
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
    presentCall: () => ({ card: 'generic', title: 'Create reviewable dashboard plan', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_confirm_dashboard_plan',
    description: 'Confirm the user-facing business intent and complete story line of a single DashboardPlan, then produce the buildable DashboardSpec. Field mapping and metrics are derived from data and semantic evidence, not separately confirmed in this MVP.',
    parameters: {
      plan: { type: 'object', required: true, additionalProperties: true, description: 'Exact DashboardPlan returned by workbench_create_dashboard_plan.' },
      confirmation: { type: 'object', required: true, additionalProperties: true, description: 'Only user-facing confirmation: { businessConfirmed: true, storylineConfirmed: true }. Never infer confirmation.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => asObject({ spec: confirmDashboardPlan(args.plan as unknown as DashboardPlan, args.confirmation as unknown as DashboardPlanConfirmation) }),
    presentCall: () => ({ card: 'generic', title: 'Confirm dashboard plan', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_list_dashboard_templates',
    description: 'List supported dashboard templates and their data contracts. Read-only.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async () => asObject({ templates: listDashboardTemplates() }),
    presentCall: () => ({ card: 'generic', title: 'List dashboard templates', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_analyze_dataset',
    description: 'Profile a CSV dataset, preview its schema, and return rule-based dashboard template and field-mapping candidates. Read-only; use this before proposing any Draft build.',
    parameters: {
      csv: { type: 'string', required: true, description: 'CSV content to analyze. Never include credentials or unrelated private data.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    execute: async (args) => asObject(analyzeCsv(args.csv)),
    presentCall: () => ({ card: 'generic', title: 'Analyze dashboard dataset', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_build_dashboard',
    description: 'Build and validate final offline dashboard HTML from the exact source bound to the confirmed Plan. The CSV is intentionally not accepted here: a model must never paste, sample, or substitute source rows during generation.',
    parameters: {
      assetId: { type: 'string', required: true, description: 'Stable lowercase dashboard asset id.' },
      spec: { type: 'object', required: true, additionalProperties: true, description: 'DashboardSpec returned by workbench_confirm_dashboard_plan.' },
      sourceLabel: { type: 'string', description: 'Business-safe source label; never provide a file path, server name, or credential.' },
      privateTerms: { type: 'array', items: { type: 'string' }, description: 'Private technical identifiers discovered during ingestion that must not appear in an offline export.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    async execute(args) {
      if (!isDashboardSpec(args.spec)) throw new Error('CONFIRMED_DASHBOARD_SPEC_REQUIRED')
      const spec = args.spec
      const bound = boundSources.get(spec.planId)
      if (!bound) throw new Error('DASHBOARD_SOURCE_NOT_BOUND_TO_PLAN')
      assertCsvMatchesSnapshot(bound.csv, spec.source)
      assertLatestPeriodComplete(bound.csv, spec.mapping.period)
      if (spec.templateId === 'sku-operations-v1') assertSkuMetricSemantics(bound.csv, spec.mapping)
      const result = await library.buildDraft(bound.csv, {
        assetId: args.assetId,
        templateId: spec.templateId,
        mapping: spec.mapping,
        spec,
        displayName: spec.title,
        sourceLabel: args.sourceLabel,
        privateTerms: args.privateTerms,
      })
      return asObject({ asset: result.asset, revision: result.revision, manifest: result.manifest, quality: result.quality, model: result.model, html: result.html, source: bound.snapshot, generationMode: 'confirmed-template' })
    },
    presentCall: () => ({ card: 'generic', title: 'Build verified dashboard HTML', kind: 'execute' }),
  }))

}
