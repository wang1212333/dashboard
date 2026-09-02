import type { DashboardDataContract } from '../dashboard-build/contracts.js'
import type { SemanticContext } from '../data-connectors/openmetadata-mcp.js'
import type { DashboardInformationArchitecture, DashboardVisualContract } from '../dashboard-build/universal-contract.js'
import type { DashboardFieldMapping, FieldProfile } from '../data-ingestion/csv-profile.js'
import type { CsvSourceSnapshot } from '../data-ingestion/source-integrity.js'

export type DashboardType = 'overview' | 'monitoring' | 'diagnostic' | 'operations' | 'risk' | 'planning' | 'reporting'
export type MetricAggregation = 'sum' | 'avg' | 'count' | 'distinctCount' | 'ratio'
export type MetricFormat = 'number' | 'currency' | 'percent' | 'duration'
export type ChartType = 'kpi' | 'line' | 'bar' | 'stackedBar' | 'pie' | 'scatter' | 'table'

/** Facts, high-confidence inferences, and business questions are deliberately separate. */
export interface DashboardIntent {
  title: string
  businessGoal: string
  dashboardType: DashboardType
  audience: string[]
  decisions: string[]
  scope: { timeRange?: string; entities?: string[]; organizations?: string[]; fixedConditions?: string[] }
  expectedMetrics: string[]
  expectedDimensions: string[]
  displayPreference?: string
  inferredItems: Array<{ field: string; value: string; confidence: number; basis: 'user' | 'data' | 'model' }>
  blockingQuestions: string[]
}

export interface DatasetProfile {
  fileName?: string
  rowCount: number
  fields: FieldProfile[]
  dateFields: string[]
  numberFields: string[]
  inferredGrain: string
  qualityRisks: string[]
}

export interface MetricDefinition {
  id: string
  name: string
  sourceFields: string[]
  expression: string
  aggregation: MetricAggregation
  format: MetricFormat
  timeGrain?: string
  confidence: number
  /** OpenMetadata records that define this metric's business meaning, never its values. */
  semanticEvidenceSourceIds: string[]
  confirmed: boolean
}

/** Why a proposed field/metric can be accepted automatically or needs review. */
export type EvidenceStatus = 'omd-verified' | 'data-validated' | 'needs-review'

export interface MappingEvidence {
  role: string
  column?: string
  status: EvidenceStatus
  confidence: number
  sourceIds: string[]
  checks: string[]
  reason: string
}

export interface MetricEvidence {
  metricId: string
  status: EvidenceStatus
  confidence: number
  sourceIds: string[]
  checks: string[]
  reason: string
}

/** A compact confirmation queue: only unresolved items are user work. */
export interface PlanConfirmationState {
  autoAcceptedMappingRoles: string[]
  autoAcceptedMetricIds: string[]
  mappingRolesNeedingReview: string[]
  /** Ambiguous optional filters/dimensions are retained as suggestions, not blockers. */
  optionalMappingRoles: string[]
  metricIdsNeedingReview: string[]
  reasons: string[]
}

export interface FilterSpec {
  id: string
  field: string
  label: string
  scope: 'global' | 'local'
  required: boolean
}

export interface ChartSpec {
  id: string
  title: string
  question: string
  type: ChartType
  dimensions: string[]
  metrics: string[]
  confirmed: boolean
}

/** The only page/module vocabulary a model may propose. The renderer owns its implementation. */
export type StorylineComponent = 'kpi-strip' | 'chart' | 'diagnostic' | 'table' | 'actions'
export type StorylinePurpose = 'overview' | 'diagnostic' | 'exploration' | 'planning' | 'monitoring' | 'coordination'

export interface StorylineModule {
  id: string
  component: StorylineComponent
  title: string
  question: string
  /** Chart ids and metric ids must exist in the same plan; the builder never evaluates model-authored formulas. */
  chartIds?: string[]
  metricIds?: string[]
  dimensions?: string[]
  inclusionReason: string
}

export interface StorylinePage {
  id: string
  title: string
  readerQuestion: string
  purpose: StorylinePurpose
  modules: StorylineModule[]
  inclusionReason: string
}

export interface StorylinePlan {
  schemaVersion: 'storyline-plan/v1'
  source: 'rules' | 'model'
  primaryQuestion: string
  narrative: string[]
  pages: StorylinePage[]
  omittedCapabilities: Array<{ capability: string; reason: string }>
  assumptionsAndRisks: string[]
}

export interface DashboardPlan {
  schemaVersion: 'dashboard-plan/v1'
  planId: string
  status: 'needs_confirmation' | 'confirmed'
  intent: DashboardIntent
  dataset: DatasetProfile
  /** Fingerprint of the original upload. The renderer must consume this exact source. */
  source: CsvSourceSnapshot
  /** Result of the retrieval phase between dataset profiling and plan generation. */
  semanticContext: SemanticContext
  informationArchitecture: DashboardInformationArchitecture
  visualContract: DashboardVisualContract
  templateId: DashboardDataContract
  mapping: DashboardFieldMapping
  mappingEvidence: MappingEvidence[]
  metrics: MetricDefinition[]
  metricEvidence: MetricEvidence[]
  confirmationState: PlanConfirmationState
  filters: FilterSpec[]
  charts: ChartSpec[]
  /** A bounded, reviewable arrangement of existing metrics/charts. */
  storylinePlan: StorylinePlan
  /** Kept for older API consumers; derived from storylinePlan.pages. */
  storyline: string[]
  risks: string[]
}

/** The only model-adjacent artifact that deterministic dashboard builders may consume. */
export interface DashboardSpec {
  schemaVersion: 'dashboard-spec/v1'
  planId: string
  title: string
  templateId: DashboardDataContract
  intent: DashboardIntent
  /** Preserved from the Plan and checked again immediately before rendering. */
  source: CsvSourceSnapshot
  semanticContext: SemanticContext
  informationArchitecture: DashboardInformationArchitecture
  visualContract: DashboardVisualContract
  mapping: DashboardFieldMapping
  mappingEvidence: MappingEvidence[]
  metrics: MetricDefinition[]
  metricEvidence: MetricEvidence[]
  confirmationState: PlanConfirmationState
  filters: FilterSpec[]
  charts: ChartSpec[]
  storylinePlan: StorylinePlan
  storyline: string[]
  confirmedAt: string
}

export interface DashboardPlanInput {
  planId: string
  fileName?: string
  businessGoal: string
  title?: string
  audience?: string[]
  decisions?: string[]
  templateId: DashboardDataContract
  mapping: DashboardFieldMapping
  fields: FieldProfile[]
  rowCount: number
  source: CsvSourceSnapshot
  riskHints?: string[]
  /** Verified result returned by workbench_assess_semantic_evidence. */
  semanticContext?: SemanticContext
  /** A selected design template translated into safe, renderer-owned tokens. */
  visualContract?: DashboardVisualContract
  /** Optional advisory arrangement proposed by the model; validated against known metrics/charts. */
  storylinePlan?: StorylinePlan
}

export interface DashboardPlanConfirmation {
  businessConfirmed: boolean
  /** Confirms page order, module purpose, and any explicitly listed assumptions. */
  storylineConfirmed: boolean
}
