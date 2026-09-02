/**
 * OpenMetadata exposes these as native DSH MCP tools once the host connector
 * is enabled. Keep this mapping separate from the data-query MCP: metadata
 * establishes meaning and lineage; a read-only data connector establishes
 * values. Neither connector receives credentials through Agent arguments.
 */
export const OPENMETADATA_MCP = {
  serverName: 'openmetadata_semantic',
  tools: {
    searchMetadata: 'mcp__openmetadata_semantic__search_metadata',
    semanticSearch: 'mcp__openmetadata_semantic__semantic_search',
    getEntityDetails: 'mcp__openmetadata_semantic__get_entity_details',
    getEntityLineage: 'mcp__openmetadata_semantic__get_entity_lineage',
  },
} as const

export interface SemanticAssetEvidence {
  fqn: string
  entityType: 'table' | 'dashboard' | 'metric' | 'chart' | 'other'
  description?: string
  domain?: string
  glossaryTerms?: string[]
  tags?: string[]
  owners?: string[]
  freshness?: string
  /** The MCP calls used to obtain this record; model prose alone is not evidence. */
  evidenceTools: Array<'semantic_search' | 'search_metadata' | 'get_entity_details' | 'get_entity_lineage'>
}

export interface SemanticEvidenceInput {
  question: string
  selectedAssets: SemanticAssetEvidence[]
  requestedMetrics?: string[]
}

/**
 * Tool calls are model-authored JSON. Normalize the two historical aliases that
 * appeared in prompts (`assets` and `adoptedAssets`) at the boundary, then keep
 * the semantic evaluator strict and predictable.
 */
export function normalizeSemanticEvidenceInput(value: unknown): SemanticEvidenceInput {
  const input = record(value)
  const rawAssets = array(input.selectedAssets ?? input.assets ?? input.adoptedAssets)
  const selectedAssets = rawAssets.map(asset => normalizeSemanticAsset(asset)).filter((asset): asset is SemanticAssetEvidence => Boolean(asset))
  return {
    question: stringValue(input.question),
    selectedAssets,
    requestedMetrics: array(input.requestedMetrics).map(stringValue).filter(Boolean),
  }
}

export interface SemanticEvidenceAssessment {
  valid: boolean
  evidenceSourceIds: string[]
  issues: string[]
  usableAssets: SemanticAssetEvidence[]
  context: SemanticContext
}

/** Immutable semantic input carried from retrieval into a dashboard Plan and Spec. */
export interface SemanticContext {
  schemaVersion: 'semantic-context/v1'
  /** verified may inform a plan; incomplete must be repaired before confirmation. */
  status: 'verified' | 'incomplete' | 'unavailable'
  question: string
  requestedMetrics: string[]
  evidenceSourceIds: string[]
  assets: SemanticAssetEvidence[]
  issues: string[]
}

export function unavailableSemanticContext(question: string, issue = 'SEMANTIC_CONTEXT_UNAVAILABLE'): SemanticContext {
  return {
    schemaVersion: 'semantic-context/v1', status: 'unavailable', question: question.trim(), requestedMetrics: [],
    evidenceSourceIds: [], assets: [], issues: [issue],
  }
}

export function isSemanticContext(value: unknown): value is SemanticContext {
  if (!value || typeof value !== 'object') return false
  const context = value as Partial<SemanticContext>
  return context.schemaVersion === 'semantic-context/v1'
    && (context.status === 'verified' || context.status === 'incomplete' || context.status === 'unavailable')
    && typeof context.question === 'string' && Array.isArray(context.requestedMetrics)
    && Array.isArray(context.evidenceSourceIds) && Array.isArray(context.assets) && Array.isArray(context.issues)
}

/**
 * Semantic search only finds candidates. A selected asset must also be read
 * through get_entity_details before it can justify a metric or a query plan.
 */
export function assessOpenMetadataEvidence(input: SemanticEvidenceInput): SemanticEvidenceAssessment {
  const issues: string[] = []
  if (!input.question?.trim()) issues.push('SEMANTIC_QUESTION_REQUIRED')
  if (!Array.isArray(input.selectedAssets) || input.selectedAssets.length === 0) issues.push('SEMANTIC_ASSET_REQUIRED')
  const usableAssets = (input.selectedAssets ?? []).filter(asset => {
    const fqn = asset.fqn?.trim()
    const hasSearch = asset.evidenceTools?.includes('semantic_search') || asset.evidenceTools?.includes('search_metadata')
    const hasDetails = asset.evidenceTools?.includes('get_entity_details')
    if (!fqn) { issues.push('SEMANTIC_ASSET_FQN_REQUIRED'); return false }
    if (!hasSearch) { issues.push(`SEMANTIC_SEARCH_EVIDENCE_REQUIRED:${fqn}`); return false }
    if (!hasDetails) { issues.push(`SEMANTIC_DETAILS_EVIDENCE_REQUIRED:${fqn}`); return false }
    if (!asset.description?.trim() && !asset.glossaryTerms?.length) { issues.push(`SEMANTIC_DEFINITION_REQUIRED:${fqn}`); return false }
    return true
  })
  const requestedMetrics = Array.isArray(input.requestedMetrics) ? input.requestedMetrics.filter((metric): metric is string => typeof metric === 'string').map(metric => metric.trim()).filter(Boolean) : []
  if (requestedMetrics.length && !usableAssets.some(asset => asset.entityType === 'metric' || asset.glossaryTerms?.length)) issues.push('SEMANTIC_METRIC_DEFINITION_REQUIRED')
  const evidenceSourceIds = usableAssets.map(asset => `openmetadata:${asset.fqn}`)
  const normalizedIssues = [...new Set(issues)]
  const valid = normalizedIssues.length === 0
  const context: SemanticContext = {
    schemaVersion: 'semantic-context/v1', status: valid ? 'verified' : 'incomplete', question: input.question?.trim() ?? '',
    requestedMetrics, evidenceSourceIds,
    assets: usableAssets, issues: normalizedIssues,
  }
  return { valid, evidenceSourceIds, issues: normalizedIssues, usableAssets, context }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }

function normalizeSemanticAsset(value: unknown): SemanticAssetEvidence | undefined {
  const asset = record(value)
  const fqn = stringValue(asset.fqn ?? asset.fullyQualifiedName)
  if (!fqn) return undefined
  const entityType = stringValue(asset.entityType)
  const validEntityType = ['table', 'dashboard', 'metric', 'chart', 'other'].includes(entityType) ? entityType as SemanticAssetEvidence['entityType'] : 'other'
  const evidenceTools = array(asset.evidenceTools ?? asset.evidenceToolsUsed)
    .map(stringValue)
    .map(tool => tool.replace(/^mcp__openmetadata_semantic__/, ''))
    .filter((tool): tool is SemanticAssetEvidence['evidenceTools'][number] => ['semantic_search', 'search_metadata', 'get_entity_details', 'get_entity_lineage'].includes(tool))
  const glossaryTerms = array(asset.glossaryTerms).map(stringValue).filter(Boolean)
  const tags = array(asset.tags).map(stringValue).filter(Boolean)
  const owners = array(asset.owners).map(stringValue).filter(Boolean)
  return {
    fqn, entityType: validEntityType, description: stringValue(asset.description ?? asset.definition) || undefined,
    domain: stringValue(asset.domain) || undefined, glossaryTerms: glossaryTerms.length ? glossaryTerms : undefined,
    tags: tags.length ? tags : undefined, owners: owners.length ? owners : undefined,
    freshness: stringValue(asset.freshness) || undefined, evidenceTools,
  }
}
