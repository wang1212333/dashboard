export interface DashboardValidationResult {
  valid: boolean
  issues: string[]
}

/** Universal dashboard template: context → conclusions → narrative → exploration → trust. */
const REQUIRED_ROLES = ['summary', 'filters', 'trend', 'diagnostic', 'actions', 'detail', 'trust']
const EXTERNAL_DEPENDENCY = /(?:https?:\/\/|<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|<iframe\b|\burl\s*\()/i
// Require a SQL-shaped phrase. A dashboard legitimately contains HTML
// <select> controls and client-side Object.fromEntries, neither of which is
// an embedded query or a data-access capability.
const QUERY_TEXT = /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+(?:table|database)|alter\s+table|create\s+(?:table|view|database)|call\s+\w+)\b|\bselect\s+[\s\S]{0,200}\bfrom\b/i

function decodeEntities(value: string): string {
  return value.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_match, entity: string) => {
    const code = entity.startsWith('x') || entity.startsWith('X') ? Number.parseInt(entity.slice(1), 16) : Number.parseInt(entity, 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : _match
  })
}

/** Validates a static export; it intentionally does not govern the live online workbench runtime. */
export function validateOfflineDashboard(html: string, forbiddenTerms: string[] = []): DashboardValidationResult {
  const issues: string[] = []
  const normalized = decodeEntities(html).toLowerCase()
  if (!/<html\b/i.test(html) || !/<main\b/i.test(html)) issues.push('HTML_DOCUMENT_REQUIRED')
  if (EXTERNAL_DEPENDENCY.test(html)) issues.push('EXTERNAL_DEPENDENCY_FORBIDDEN')
  if (QUERY_TEXT.test(normalized)) issues.push('QUERY_TEXT_FORBIDDEN')
  if (!/data-dashboard-role\s*=\s*["']summary["'][^>]*\bdata-freshness\s*=/i.test(html)) issues.push('FRESHNESS_REQUIRED')
  const requiredRoles = /data-dashboard-adaptive\s*=\s*["']true["']/i.test(html)
    ? ['summary', 'filters', 'detail', 'trust']
    : REQUIRED_ROLES
  for (const role of requiredRoles) {
    if (!new RegExp(`data-dashboard-role\\s*=\\s*["']${role}["']`, 'i').test(html)) issues.push(`ROLE_REQUIRED:${role}`)
  }
  const kpiCount = (html.match(/data-dashboard-role\s*=\s*["']kpi["']/gi) ?? []).length
  if (kpiCount < 3 || kpiCount > 6) issues.push('KPI_COUNT_MUST_BE_3_TO_6')
  for (const term of forbiddenTerms.filter(Boolean)) {
    if (normalized.includes(decodeEntities(term).toLowerCase())) issues.push(`FORBIDDEN_TERM:${term}`)
  }
  return { valid: issues.length === 0, issues }
}
