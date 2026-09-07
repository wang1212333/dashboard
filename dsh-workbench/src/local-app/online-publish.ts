import type { KnowledgeLibrary } from '../library/knowledge-library.js'

/** Credentials remain on the local host; only the published HTML leaves the library. */
export async function publishOnline(library: KnowledgeLibrary, assetId: string): Promise<unknown> {
  const configured = process.env.DSH_ONLINE_URL
  const token = process.env.DSH_ONLINE_ADMIN_TOKEN
  if (!configured || !token) throw new Error('PUBLISH_ONLINE_NOT_CONFIGURED:请先配置线上服务地址与发布凭据')
  const target = new URL(configured)
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(target.hostname))) throw new Error('PUBLISH_ONLINE_URL_INVALID')
  if (target.search || target.hash || target.username || target.password) throw new Error('PUBLISH_ONLINE_URL_INVALID')
  const stored = await library.getRelease(assetId)
  const call = async (path: string, value: unknown) => {
    const response = await fetch(configured.replace(/\/$/, '') + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(value),
    })
    const result = await response.json() as Record<string, unknown>
    if (!response.ok) throw new Error(`PUBLISH_ONLINE_FAILED:${String(result.error || response.status)}`)
    return result
  }
  await call('/api/releases', { assetId, revision: stored.revision.revision, title: stored.manifest.displayName, html: stored.html })
  return call('/api/shares', { assetId, revision: stored.revision.revision, days: 7 })
}
