import type { KnowledgeLibrary } from '../library/knowledge-library.js'
import type { NativeWorkbenchSessions } from '../native-workbench-sessions.js'
import { toDashboardSummary } from './dashboard-repository.js'

/** User-facing lifecycle projection. Never manufacture publication or version metadata. */
export async function dashboardCatalog(library: KnowledgeLibrary, prefix: string, includeDrafts: boolean, sessions?: NativeWorkbenchSessions) {
  const sources = await sessions?.draftSources() ?? {}
  const assets = (await library.listAssets()).filter(asset => includeDrafts ? asset.latestRevision : asset.releasedRevision)
  return Promise.all(assets.map(async asset => {
    const revision = includeDrafts ? asset.latestRevision : asset.releasedRevision!
    const stored = await library.readRevision(asset.assetId, revision)
    return {
      ...toDashboardSummary({ ...asset, displayName: stored.manifest.displayName }, `${prefix}/assets/${asset.assetId}/${revision}/dashboard.html`, stored.model),
      revision, currentVersion: Number(revision.slice(4)),
      status: revision === asset.releasedRevision ? 'published' : 'draft',
      latestRevision: asset.latestRevision, releasedRevision: asset.releasedRevision,
      sourceConversationId: sources[asset.assetId],
    }
  }))
}

export async function dashboardVersions(library: KnowledgeLibrary, assetId: string, prefix: string) {
  const asset = await library.getAsset(assetId)
  const latest = Number(asset.latestRevision.slice(4))
  if (!Number.isInteger(latest) || latest < 1 || latest > 9999) throw new Error('REVISION_INVALID')
  const versions = []
  for (let version = latest; version >= 1; version--) {
    const revision = 'rev-' + String(version).padStart(4, '0')
    try {
      const stored = await library.readRevision(assetId, revision)
      versions.push({ revision, stage: stored.revision.stage, updatedAt: stored.revision.updatedAt,
        current: revision === asset.releasedRevision, url: `${prefix}/assets/${assetId}/${revision}/dashboard.html` })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !/NOT_FOUND/.test(String(error))) throw error
    }
  }
  return { assetId, versions }
}
