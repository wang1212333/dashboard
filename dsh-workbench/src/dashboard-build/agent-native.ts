import type { AgentNativeDashboardModel, DashboardBuildResult, DashboardManifest, DashboardTemplate, DataQualityReport } from './contracts.js'

export interface AgentNativeDashboardInput {
  assetId: string
  html: string
  title?: string
  summary?: string
  sourceLabel?: string
  csv?: string
  previousManifest?: DashboardManifest
}

export const AGENT_NATIVE_TEMPLATE: DashboardTemplate = {
  id: 'agent-native/v1',
  displayName: '原生 DSH 自由生成看板',
  dataContract: 'agent-native/v1',
  expectedColumns: [],
  requiredKpis: [],
}

/**
 * Persists the model's complete HTML as an artifact without translating it
 * through the former domain-template, Plan, Spec, or confirmation contracts.
 */
export function buildAgentNativeDashboard(input: AgentNativeDashboardInput): DashboardBuildResult<AgentNativeDashboardModel> {
  if (!/^[a-z][a-z0-9-]{2,62}$/.test(input.assetId)) throw new Error('ASSET_ID_INVALID: use lowercase letters, numbers, and hyphens')
  const html = input.html.trim()
  if (!/<html\b/i.test(html)) throw new Error('HTML_DOCUMENT_REQUIRED')
  const now = new Date().toISOString()
  const previous = input.previousManifest
  const revision = nextRevision(previous?.revision)
  const title = input.title?.trim() || previous?.displayName || 'AI 数据看板'
  const manifest: DashboardManifest = {
    assetId: input.assetId,
    displayName: title,
    source: { kind: 'csv', label: input.sourceLabel?.trim() || previous?.source.label || '用户提供的数据' },
    templateId: AGENT_NATIVE_TEMPLATE.id,
    dataContract: 'agent-native/v1',
    revision,
    status: 'draft',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
  const quality: DataQualityReport = { validRows: estimateRows(input.csv), rejectedRows: [] }
  const model: AgentNativeDashboardModel = {
    kind: 'agent-native/v1',
    title,
    ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
  }
  return { html, manifest, quality, model, template: AGENT_NATIVE_TEMPLATE }
}

function nextRevision(previous?: string): string {
  const value = previous ? Number(previous.replace('rev-', '')) + 1 : 1
  return `rev-${String(value).padStart(4, '0')}`
}

function estimateRows(csv?: string): number {
  if (!csv?.trim()) return 0
  return Math.max(0, csv.split(/\r?\n/).filter(line => line.trim()).length - 1)
}
