import { buildDashboardFromCsv, type BuildDashboardOptions } from '../dashboard-build/build.js'
import type { DashboardManifest } from '../dashboard-build/contracts.js'
import type { LibraryAsset, ReleasePointer, RevisionRecord, StoredDashboardRevision } from './contracts.js'
import type { KnowledgeLibrary, LifecycleCommand } from './knowledge-library.js'
import type { AuditEventInput, IdentityProvider, MetadataAsset, MetadataRepository, MetadataRevision, ObjectStore, WorkspacePrincipal } from './ports.js'
import { WorkspaceAuthorizer } from './ports.js'

const ASSET_ID = /^[a-z][a-z0-9-]{2,62}$/

/**
 * Production lifecycle adapter. Object payloads are immutable; metadata owns
 * workspace scope, state transitions, release pointers and durable audit.
 */
export class WorkspaceKnowledgeLibrary implements KnowledgeLibrary {
  constructor(
    private readonly objects: ObjectStore,
    private readonly metadata: MetadataRepository,
    private readonly identity: IdentityProvider,
    private readonly authorizer = new WorkspaceAuthorizer(),
  ) {}

  async buildDraft(csv: string, options: BuildDashboardOptions): Promise<StoredDashboardRevision> {
    const actor = await this.authorize('dashboard.draft.create')
    this.assertAssetId(options.assetId)
    const previous = await this.metadata.getAsset(actor.workspaceId, options.assetId)
    const previousManifest = previous ? await this.readManifest(actor.workspaceId, options.assetId, previous.asset.latestRevision) : undefined
    const built = buildDashboardFromCsv(csv, { ...options, previousManifest })
    const asset = this.toAsset(built.manifest, previous)
    const revision: RevisionRecord = {
      assetId: asset.assetId,
      revision: built.manifest.revision,
      stage: 'draft',
      createdAt: built.manifest.updatedAt,
      updatedAt: built.manifest.updatedAt,
      quality: built.quality,
    }
    const artifacts = this.artifactKeys(actor.workspaceId, asset.assetId, revision.revision)
    await Promise.all([
      this.objects.putImmutable(artifacts.htmlKey, built.html, 'text/html; charset=utf-8'),
      this.objects.putImmutable(artifacts.manifestKey, JSON.stringify(built.manifest), 'application/json'),
      this.objects.putImmutable(artifacts.modelKey, JSON.stringify(built.model), 'application/json'),
      this.objects.putImmutable(artifacts.qualityKey, JSON.stringify(built.quality), 'application/json'),
    ])
    await this.metadata.createDraft({
      workspaceId: actor.workspaceId,
      asset,
      revision: { record: revision, artifacts },
      audit: this.audit('dashboard.draft.create', actor, asset.assetId, revision.revision),
    })
    return { asset, revision, manifest: built.manifest, quality: built.quality, model: built.model, html: built.html }
  }

  async preview(assetId: string, revision?: string): Promise<StoredDashboardRevision> {
    const actor = await this.authorize('dashboard.preview')
    const resolved = await this.resolveRevision(actor.workspaceId, assetId, revision)
    const updated = await this.metadata.preview({
      workspaceId: actor.workspaceId,
      assetId,
      revision: resolved.record.revision,
      audit: this.audit('dashboard.preview', actor, assetId, resolved.record.revision),
    })
    return this.readStored(actor.workspaceId, assetId, updated)
  }

  async release(assetId: string, revision?: string, command?: LifecycleCommand): Promise<ReleasePointer> {
    const actor = await this.authorize('dashboard.release')
    const resolved = await this.resolveRevision(actor.workspaceId, assetId, revision)
    const approvalId = this.requireApproval(command)
    return this.metadata.release({
      workspaceId: actor.workspaceId,
      assetId,
      revision: resolved.record.revision,
      approvalId,
      audit: this.audit('dashboard.release', actor, assetId, resolved.record.revision),
    })
  }

  async rollback(assetId: string, targetRevision: string, command?: LifecycleCommand): Promise<ReleasePointer> {
    const actor = await this.authorize('dashboard.rollback')
    const approvalId = this.requireApproval(command)
    return this.metadata.rollback({
      workspaceId: actor.workspaceId,
      assetId,
      revision: targetRevision,
      approvalId,
      audit: this.audit('dashboard.rollback', actor, assetId, targetRevision),
    })
  }

  async getRelease(assetId: string): Promise<StoredDashboardRevision> {
    const actor = await this.authorize('dashboard.read')
    const pointer = await this.metadata.getRelease(actor.workspaceId, assetId)
    if (!pointer) throw new Error(`RELEASE_NOT_FOUND:${assetId}`)
    await this.metadata.appendAudit(this.audit('dashboard.read', actor, assetId, pointer.revision, { target: 'release' }))
    const revision = await this.requireRevision(actor.workspaceId, assetId, pointer.revision)
    return this.readStored(actor.workspaceId, assetId, revision)
  }

  async readRevision(assetId: string, revision?: string): Promise<StoredDashboardRevision> {
    const actor = await this.authorize('dashboard.read')
    const resolved = await this.resolveRevision(actor.workspaceId, assetId, revision)
    await this.metadata.appendAudit(this.audit('dashboard.read', actor, assetId, resolved.record.revision, { target: 'revision' }))
    return this.readStored(actor.workspaceId, assetId, resolved)
  }

  async getAsset(assetId: string): Promise<LibraryAsset> {
    const actor = await this.authorize('dashboard.read')
    const asset = await this.metadata.getAsset(actor.workspaceId, assetId)
    if (!asset) throw new Error(`ASSET_NOT_FOUND:${assetId}`)
    await this.metadata.appendAudit(this.audit('dashboard.read', actor, assetId, undefined, { target: 'asset' }))
    return asset.asset
  }

  private async authorize(action: AuditEventInput['action']): Promise<WorkspacePrincipal> {
    const actor = await this.identity.current()
    this.authorizer.assert(actor, action)
    return actor
  }

  private async resolveRevision(workspaceId: string, assetId: string, revision?: string): Promise<MetadataRevision> {
    const asset = await this.metadata.getAsset(workspaceId, assetId)
    if (!asset) throw new Error(`ASSET_NOT_FOUND:${assetId}`)
    return this.requireRevision(workspaceId, assetId, revision ?? asset.asset.latestRevision)
  }

  private async requireRevision(workspaceId: string, assetId: string, revision: string): Promise<MetadataRevision> {
    const stored = await this.metadata.getRevision(workspaceId, assetId, revision)
    if (!stored) throw new Error(`REVISION_NOT_FOUND:${revision}`)
    return stored
  }

  private async readStored(workspaceId: string, assetId: string, metadataRevision: MetadataRevision): Promise<StoredDashboardRevision> {
    const asset = await this.metadata.getAsset(workspaceId, assetId)
    if (!asset) throw new Error(`ASSET_NOT_FOUND:${assetId}`)
    const [html, manifestText, modelText] = await Promise.all([
      this.objects.getText(metadataRevision.artifacts.htmlKey),
      this.objects.getText(metadataRevision.artifacts.manifestKey),
      this.objects.getText(metadataRevision.artifacts.modelKey),
    ])
    return {
      asset: asset.asset,
      revision: metadataRevision.record,
      manifest: JSON.parse(manifestText) as DashboardManifest,
      quality: metadataRevision.record.quality,
      model: JSON.parse(modelText) as StoredDashboardRevision['model'],
      html,
    }
  }

  private async readManifest(workspaceId: string, assetId: string, revision: string): Promise<DashboardManifest> {
    const metadataRevision = await this.requireRevision(workspaceId, assetId, revision)
    return JSON.parse(await this.objects.getText(metadataRevision.artifacts.manifestKey)) as DashboardManifest
  }

  private toAsset(manifest: DashboardManifest, previous?: MetadataAsset): LibraryAsset {
    return {
      assetId: manifest.assetId,
      displayName: manifest.displayName,
      source: manifest.source,
      templateId: manifest.templateId,
      dataContract: manifest.dataContract,
      createdAt: previous?.asset.createdAt ?? manifest.createdAt,
      updatedAt: manifest.updatedAt,
      latestRevision: manifest.revision,
      releasedRevision: previous?.asset.releasedRevision,
    }
  }

  private artifactKeys(workspaceId: string, assetId: string, revision: string): MetadataRevision['artifacts'] {
    const prefix = `workspaces/${workspaceId}/assets/${assetId}/revisions/${revision}`
    return { htmlKey: `${prefix}/dashboard.html`, manifestKey: `${prefix}/manifest.json`, modelKey: `${prefix}/model.json`, qualityKey: `${prefix}/quality.json` }
  }

  private audit(action: AuditEventInput['action'], actor: WorkspacePrincipal, assetId: string, revision?: string, detail?: Record<string, string>): AuditEventInput {
    return { action, actor, assetId, revision, detail }
  }

  private assertAssetId(assetId: string): void { if (!ASSET_ID.test(assetId)) throw new Error('ASSET_ID_INVALID') }
  private requireApproval(command?: LifecycleCommand): string {
    if (!command?.approvalId) throw new Error('APPROVAL_REQUIRED: host-issued approval id is required')
    return command.approvalId
  }
}
