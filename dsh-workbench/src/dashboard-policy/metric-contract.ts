export interface MetricContract {
  label: string
  definition: string
  formula?: string
  unit: string
  direction: 'higher-is-better' | 'lower-is-better' | 'range-bound'
  grain: string
  timeframe: { start: string; end: string; timezone: string }
  comparison: 'prior-period' | 'target' | 'plan' | 'budget' | 'benchmark' | 'none'
  evidenceSourceIds: string[]
  valueRole?: 'actual' | 'target' | 'plan' | 'budget' | 'benchmark' | 'reference'
  currency?: string
  freshness?: string
}

export function validateMetricContract(contract: MetricContract): string[] {
  const issues: string[] = []
  if (!contract.label.trim()) issues.push('METRIC_LABEL_REQUIRED')
  if (!contract.definition.trim()) issues.push('METRIC_DEFINITION_REQUIRED')
  if (!contract.unit.trim()) issues.push('METRIC_UNIT_REQUIRED')
  if (!contract.grain.trim()) issues.push('METRIC_GRAIN_REQUIRED')
  if (!contract.timeframe.start || !contract.timeframe.end || !contract.timeframe.timezone) issues.push('METRIC_TIMEFRAME_REQUIRED')
  if (new Date(contract.timeframe.start) > new Date(contract.timeframe.end)) issues.push('METRIC_TIMEFRAME_INVALID')
  if (contract.evidenceSourceIds.length === 0) issues.push('METRIC_EVIDENCE_REQUIRED')
  if (contract.comparison !== 'none' && !contract.valueRole) issues.push('METRIC_VALUE_ROLE_REQUIRED')
  if (contract.unit.trim().toLowerCase() === 'currency' && !contract.currency?.trim()) issues.push('METRIC_CURRENCY_REQUIRED')
  return issues
}
