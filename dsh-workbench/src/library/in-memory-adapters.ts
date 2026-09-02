import type { AuditEvent, AuditEventInput, MetadataAsset, MetadataRepository, MetadataRevision, ObjectStore } from './ports.js'
import type { ReleasePointer } from './contracts.js'

const assetKey = (workspaceId: string, assetId: string) => `${workspaceId}:${assetId}`
const revisionKey = (workspaceId: string, assetId: string, revision: string) => `${workspaceId}:${assetId}:${revision}`

/** Test/dev stand-ins. They deliberately model immutable blobs and transactional metadata mutations. */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, string>()

  async putImmutable(key: string, body: string): Promise<void> {
    if (this.objects.has(key)) throw new Error(`OBJECT_ALREADY_EXISTS:${key}`)
    this.objects.set(key, body)
  }

  async getText(key: string): Promise<string> {
    const body = this.objects.get(key)
    if (body === undefined) throw new Error(`OBJECT_NOT_FOUND:${key}`)
    return body
  }
}

export class InMemoryMetadataRepository implements MetadataRepository {
  private readonly assets = new Map<string, MetadataAsset>()
  private readonly revisions = new Map<string, MetadataRevision>()
  private readonly releases = new Map<string, ReleasePointer>()
  private readonly audits: AuditEvent[] = []

  async getAsset(workspaceId: string, assetId: string): Promise<MetadataAsset | undefined> { return this.assets.get(assetKey(workspaceId, assetId)) }
  async listAssets(workspaceId: string): Promise<MetadataAsset[]> { return [...this.assets.values()].filter(asset => asset.workspaceId === workspaceId).sort((left, right) => right.asset.updatedAt.localeCompare(left.asset.updatedAt)) }
  async getRevision(workspaceId: string, assetId: string, revision: string): Promise<MetadataRevision | undefined> { return this.revisions.get(revisionKey(workspaceId, assetId, revision)) }

  async createDraft(input: { workspaceId: string; asset: MetadataAsset['asset']; revision: MetadataRevision; audit: AuditEventInput }): Promise<void> {
    const key = assetKey(input.workspaceId, input.asset.assetId)
    const revisionKeyValue = revisionKey(input.workspaceId, input.asset.assetId, input.revision.record.revision)
    if (this.revisions.has(revisionKeyValue)) throw new Error(`REVISION_ALREADY_EXISTS:${input.revision.record.revision}`)
    const previous = this.assets.get(key)
    if (previous && input.revision.record.revision <= previous.asset.latestRevision) throw new Error('REVISION_CONFLICT')
    this.revisions.set(revisionKeyValue, input.revision)
    this.assets.set(key, { workspaceId: input.workspaceId, asset: input.asset, version: (previous?.version ?? 0) + 1 })
    this.record(input.audit)
  }

  async preview(input: { workspaceId: string; assetId: string; revision: string; audit: AuditEventInput }): Promise<MetadataRevision> {
    const current = this.requireRevision(input.workspaceId, input.assetId, input.revision)
    if (current.record.stage === 'released') return current
    if (current.record.stage !== 'draft') throw new Error(`PREVIEW_NOT_ALLOWED:${current.record.stage}`)
    const next = { ...current, record: { ...current.record, stage: 'preview' as const, updatedAt: new Date().toISOString() } }
    this.revisions.set(revisionKey(input.workspaceId, input.assetId, input.revision), next)
    this.record(input.audit)
    return next
  }

  async release(input: { workspaceId: string; assetId: string; revision: string; approvalId: string; audit: AuditEventInput }): Promise<ReleasePointer> {
    const current = this.requireRevision(input.workspaceId, input.assetId, input.revision)
    if (current.record.stage !== 'preview') throw new Error('RELEASE_REQUIRES_PREVIEW')
    const now = new Date().toISOString()
    this.revisions.set(revisionKey(input.workspaceId, input.assetId, input.revision), { ...current, record: { ...current.record, stage: 'released', updatedAt: now } })
    const asset = this.requireAsset(input.workspaceId, input.assetId)
    this.assets.set(assetKey(input.workspaceId, input.assetId), { ...asset, asset: { ...asset.asset, releasedRevision: input.revision, updatedAt: now }, version: asset.version + 1 })
    const pointer: ReleasePointer = { assetId: input.assetId, revision: input.revision, releasedAt: now, reason: 'release' }
    this.releases.set(assetKey(input.workspaceId, input.assetId), pointer)
    this.record(input.audit)
    return pointer
  }

  async rollback(input: { workspaceId: string; assetId: string; revision: string; approvalId: string; audit: AuditEventInput }): Promise<ReleasePointer> {
    const current = this.requireRevision(input.workspaceId, input.assetId, input.revision)
    if (current.record.stage === 'draft') throw new Error('ROLLBACK_REQUIRES_PREVIEW_OR_RELEASED_REVISION')
    const now = new Date().toISOString()
    const asset = this.requireAsset(input.workspaceId, input.assetId)
    this.assets.set(assetKey(input.workspaceId, input.assetId), { ...asset, asset: { ...asset.asset, releasedRevision: input.revision, updatedAt: now }, version: asset.version + 1 })
    const pointer: ReleasePointer = { assetId: input.assetId, revision: input.revision, releasedAt: now, reason: 'rollback' }
    this.releases.set(assetKey(input.workspaceId, input.assetId), pointer)
    this.record(input.audit)
    return pointer
  }

  async getRelease(workspaceId: string, assetId: string): Promise<ReleasePointer | undefined> { return this.releases.get(assetKey(workspaceId, assetId)) }
  async appendAudit(event: AuditEventInput): Promise<void> { this.record(event) }
  async listAudit(workspaceId: string, assetId: string): Promise<AuditEvent[]> { return this.audits.filter((event) => event.actor.workspaceId === workspaceId && event.assetId === assetId) }

  private requireAsset(workspaceId: string, assetId: string): MetadataAsset {
    const asset = this.assets.get(assetKey(workspaceId, assetId))
    if (!asset) throw new Error(`ASSET_NOT_FOUND:${assetId}`)
    return asset
  }

  private requireRevision(workspaceId: string, assetId: string, revision: string): MetadataRevision {
    const item = this.revisions.get(revisionKey(workspaceId, assetId, revision))
    if (!item) throw new Error(`REVISION_NOT_FOUND:${revision}`)
    return item
  }

  private record(event: AuditEventInput): void {
    this.audits.push({ ...event, eventId: `audit-${String(this.audits.length + 1).padStart(6, '0')}`, occurredAt: new Date().toISOString() })
  }
}
