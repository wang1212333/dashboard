import { validateMetricContract, type MetricContract } from './metric-contract.js'
import { reconcileDatasets, type DatasetDescriptor, type RelationshipContract } from './reconciliation.js'
import { decideOperatingMode, type RoutingInput } from './source-routing.js'

export type DashboardComponent = 'kpi' | 'trend' | 'comparison' | 'diagnostic' | 'action' | 'detail' | 'filter'

/** A reviewable business gate that never accepts credentials, SQL, or raw connection identifiers. */
export interface DashboardGovernanceInput {
  routing: RoutingInput
  metrics: MetricContract[]
  datasets: DatasetDescriptor[]
  relationships: RelationshipContract[]
  components: DashboardComponent[]
  businessConfirmed: boolean
}

export interface DashboardGovernanceResult {
  valid: boolean
  mode: ReturnType<typeof decideOperatingMode>['mode']
  issues: string[]
}

export function assessDashboardGovernance(input: DashboardGovernanceInput): DashboardGovernanceResult {
  const candidate = input as Partial<DashboardGovernanceInput>
  if (!candidate.routing || !Array.isArray(candidate.metrics) || !Array.isArray(candidate.datasets) || !Array.isArray(candidate.relationships) || !Array.isArray(candidate.components) || typeof candidate.businessConfirmed !== 'boolean') {
    const missing = [
      !candidate.routing ? 'GOVERNANCE_ROUTING_REQUIRED' : undefined,
      !Array.isArray(candidate.metrics) ? 'GOVERNANCE_METRICS_REQUIRED' : undefined,
      !Array.isArray(candidate.datasets) ? 'GOVERNANCE_DATASETS_REQUIRED' : undefined,
      !Array.isArray(candidate.relationships) ? 'GOVERNANCE_RELATIONSHIPS_REQUIRED' : undefined,
      !Array.isArray(candidate.components) ? 'GOVERNANCE_COMPONENTS_REQUIRED' : undefined,
      typeof candidate.businessConfirmed !== 'boolean' ? 'GOVERNANCE_CONFIRMATION_REQUIRED' : undefined,
    ].filter((issue): issue is string => Boolean(issue))
    return { valid: false, mode: 'file-only', issues: ['GOVERNANCE_INPUT_INVALID', ...missing] }
  }
  const routing = decideOperatingMode(input.routing)
  const issues = [...routing.issues]
  if (!input.businessConfirmed) issues.push('BUSINESS_CONFIRMATION_REQUIRED')
  if (input.metrics.length < 3 || input.metrics.length > 4) issues.push('KPI_COUNT_MUST_BE_3_OR_4')
  input.metrics.forEach((metric) => issues.push(...validateMetricContract(metric)))
  issues.push(...reconcileDatasets(input.datasets, input.relationships))
  if (!input.components.includes('trend') && !input.components.includes('comparison')) issues.push('TREND_OR_COMPARISON_REQUIRED')
  if (!input.components.includes('diagnostic')) issues.push('DIAGNOSTIC_REQUIRED')
  if (!input.components.includes('action')) issues.push('ACTION_REQUIRED')
  if (input.components.includes('kpi') && input.metrics.length === 0) issues.push('KPI_EVIDENCE_REQUIRED')
  return { valid: issues.length === 0, mode: routing.mode, issues: [...new Set(issues)] }
}
