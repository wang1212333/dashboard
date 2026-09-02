export interface DatasetDescriptor {
  id: string
  metricLabel: string
  role: 'actual' | 'target' | 'plan' | 'budget' | 'mapping' | 'reference'
  unit: string
  grain: string
  timeframe: string
  value?: number
  definition?: string
  currency?: string
  timezone?: string
  freshness?: string
  filters?: string
}

export interface RelationshipContract {
  leftDatasetId: string
  rightDatasetId: string
  verifiedBy: 'governed-relationship' | 'business-key' | 'user-confirmation'
  expectedCardinality: 'one-to-one' | 'many-to-one' | 'one-to-many'
  keysVerified?: boolean
  nullKeys?: number
  duplicateKeys?: number
}

/** Returns blockers; callers must request a decision rather than silently choosing a value. */
export function reconcileDatasets(datasets: DatasetDescriptor[], relationships: RelationshipContract[]): string[] {
  const issues: string[] = []
  const ids = new Set(datasets.map((dataset) => dataset.id))
  for (const relationship of relationships) {
    if (!ids.has(relationship.leftDatasetId) || !ids.has(relationship.rightDatasetId)) {
      issues.push('RELATIONSHIP_DATASET_MISSING')
    }
    if (relationship.keysVerified === false) issues.push('RELATIONSHIP_KEY_UNVERIFIED')
    if ((relationship.nullKeys ?? 0) > 0) issues.push('RELATIONSHIP_NULL_KEY_CONFLICT')
    if ((relationship.duplicateKeys ?? 0) > 0 && relationship.expectedCardinality !== 'one-to-many') issues.push('RELATIONSHIP_DUPLICATE_KEY_CONFLICT')
  }
  const grouped = new Map<string, DatasetDescriptor[]>()
  for (const dataset of datasets) {
    const key = `${dataset.metricLabel}|${dataset.timeframe}`
    grouped.set(key, [...(grouped.get(key) ?? []), dataset])
  }
  for (const candidates of grouped.values()) {
    const actuals = candidates.filter((candidate) => candidate.role === 'actual')
    if (actuals.length > 1) {
      if (new Set(actuals.map((candidate) => candidate.unit)).size > 1) issues.push('ACTUAL_UNIT_CONFLICT')
      if (new Set(actuals.map((candidate) => candidate.grain)).size > 1) issues.push('ACTUAL_GRAIN_CONFLICT')
      if (new Set(actuals.map((candidate) => candidate.value)).size > 1) issues.push('ACTUAL_VALUE_CONFLICT')
      if (new Set(actuals.map((candidate) => candidate.definition ?? '')).size > 1) issues.push('ACTUAL_DEFINITION_CONFLICT')
      if (new Set(actuals.map((candidate) => candidate.currency ?? '')).size > 1) issues.push('ACTUAL_CURRENCY_CONFLICT')
      if (new Set(actuals.map((candidate) => candidate.timezone ?? '')).size > 1) issues.push('ACTUAL_TIMEZONE_CONFLICT')
      if (new Set(actuals.map((candidate) => candidate.filters ?? '')).size > 1) issues.push('ACTUAL_FILTER_CONFLICT')
    }
  }
  return [...new Set(issues)]
}
