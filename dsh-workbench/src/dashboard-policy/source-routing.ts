/** Business-safe source routing distilled from the dashboard skill. */
export type SourceKind = 'conversation' | 'file' | 'metadata' | 'query'
export type OperatingMode = 'file-only' | 'product-only' | 'dual-source'
export type DashboardContribution = 'kpi' | 'comparison' | 'filter' | 'diagnostic' | 'detail' | 'action'

export interface EvidenceSource {
  id: string
  kind: SourceKind
  /** A user-facing role; never expose implementation identifiers in an export. */
  businessRole: 'definition' | 'actual' | 'target' | 'plan' | 'mapping' | 'context'
  usable: boolean
  contributions: DashboardContribution[]
  /** Whether this attachment/source is in scope, even if it later proves unusable. */
  relevant?: boolean
  /** Query values must be real business evidence, not an authorization or schema probe. */
  hasVerifiedBusinessValues?: boolean
  /** Metadata must resolve the product and the relevant assets/relationships. */
  metadataVerified?: boolean
}

export interface RoutingInput {
  sources: EvidenceSource[]
  confirmedProduct: boolean
}

export interface RoutingDecision {
  mode: OperatingMode
  requiredSourceKinds: SourceKind[]
  issues: string[]
}

export function decideOperatingMode(input: RoutingInput): RoutingDecision {
  const relevantFile = input.sources.some((source) => source.kind === 'file' && source.relevant !== false)
  const usableFile = input.sources.some((source) => source.kind === 'file' && source.relevant !== false && source.usable)
  const usableQuery = input.sources.some((source) => source.kind === 'query' && source.usable && source.hasVerifiedBusinessValues === true)
  const usableMetadata = input.sources.some((source) => source.kind === 'metadata' && source.usable && source.metadataVerified === true)
  const requiredSourceKinds: SourceKind[] = input.confirmedProduct
    ? (relevantFile ? ['file', 'metadata', 'query'] : ['metadata', 'query'])
    : ['file']
  const mode: OperatingMode = input.confirmedProduct
    ? (relevantFile ? 'dual-source' : 'product-only')
    : 'file-only'
  const issues: string[] = []

  if (!input.confirmedProduct && !usableFile) issues.push('FILE_EVIDENCE_REQUIRED')
  if (input.confirmedProduct && !usableQuery) issues.push('QUERY_BUSINESS_EVIDENCE_REQUIRED')
  if (input.confirmedProduct && !usableMetadata) {
    issues.push('METADATA_EVIDENCE_REQUIRED')
  }
  if (relevantFile && !usableFile) issues.push('FILE_EVIDENCE_REQUIRED')
  for (const kind of requiredSourceKinds) {
    // Metadata governs definitions and relationships; it is not observed business-value evidence.
    if (kind === 'metadata') continue
    const eligible = input.sources.filter((source) => source.kind === kind && source.usable)
    if (eligible.length > 0 && !eligible.some((source) => source.contributions.length > 0 && (kind !== 'query' || source.hasVerifiedBusinessValues === true))) {
      issues.push(`SOURCE_CONTRIBUTION_REQUIRED:${kind}`)
    }
  }
  return { mode, requiredSourceKinds, issues: [...new Set(issues)] }
}
