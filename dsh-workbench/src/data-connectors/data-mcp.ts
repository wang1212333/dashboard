/**
 * DSH-facing contract for a governed, read-only data connector.
 * Authentication belongs to the DSH host or API gateway, never generated HTML.
 */
export interface ReadOnlyDataClient {
  listCapabilities(signal?: AbortSignal): Promise<string[]>
  query(sql: string, signal?: AbortSignal): Promise<{ rows: Array<Record<string, unknown>>; freshness?: string }>
}

export function assertReadOnlyBoundedSql(sql: string): void {
  const normalized = sql.replace(/--[^\n\r]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!normalized || normalized.includes(';')) throw new Error('QUERY_MUST_BE_SINGLE_STATEMENT')
  if (!/^(select|with)\b/.test(normalized)) throw new Error('QUERY_MUST_BE_READ_ONLY')
  if (/\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|call|exec|copy|load|unload)\b/.test(normalized)) throw new Error('QUERY_MUST_BE_READ_ONLY')
  const limit = normalized.match(/\blimit\s+(\d+)\b/)
  if (!limit) throw new Error('QUERY_BOUND_REQUIRED')
  if (Number(limit[1]) > 1000) throw new Error('QUERY_LIMIT_TOO_LARGE')
  if (/\bselect\s+(?:distinct\s+)?\*/.test(normalized)) throw new Error('QUERY_WILDCARD_FORBIDDEN')
  if (normalized.startsWith('with ') && !/\)\s*select\b[\s\S]*\blimit\s+\d+\s*$/.test(normalized)) throw new Error('QUERY_CTE_MUST_END_IN_SELECT')
}
