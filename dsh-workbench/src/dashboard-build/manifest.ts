import type { DashboardManifest, DashboardManifestInput, DashboardTemplate } from './contracts.js'

const ASSET_ID = /^[a-z][a-z0-9-]{2,62}$/

function nextRevision(previous?: string): string {
  const number = previous ? Number(previous.replace('rev-', '')) + 1 : 1
  return `rev-${String(number).padStart(4, '0')}`
}

export function createDraftManifest(input: DashboardManifestInput, template: DashboardTemplate, previous?: DashboardManifest): DashboardManifest {
  if (!ASSET_ID.test(input.assetId)) throw new Error('ASSET_ID_INVALID: use lowercase letters, numbers, and hyphens')
  if (previous && previous.assetId !== input.assetId) throw new Error('ASSET_ID_MISMATCH')
  if (previous && previous.templateId !== template.id) throw new Error('TEMPLATE_CHANGE_REQUIRES_NEW_ASSET')
  const now = new Date().toISOString()
  return {
    assetId: input.assetId,
    displayName: input.displayName?.trim() || previous?.displayName || template.displayName,
    source: { kind: 'csv', label: input.sourceLabel?.trim() || previous?.source.label || 'CSV 数据集' },
    templateId: template.id,
    dataContract: template.dataContract,
    fieldMapping: input.mapping,
    spec: input.spec,
    revision: nextRevision(previous?.revision),
    status: 'draft',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}
