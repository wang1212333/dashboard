import type { LibraryAsset, ReleasePointer, RevisionRecord } from './contracts.js'

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer'
export type LibraryAction = 'dashboard.read' | 'dashboard.draft.create' | 'dashboard.preview' | 'dashboard.release' | 'dashboard.rollback'

/** Supplied by trusted DSH host middleware, never by an Agent tool parameter. */
export interface WorkspacePrincipal {
  userId: string
  workspaceId: string
  roles: WorkspaceRole[]
  requestId?: string
}

export interface IdentityProvider {
  current(): Promise<WorkspacePrincipal>
}

export interface RevisionArtifacts {
  htmlKey: string
  manifestKey: string
  modelKey: string
  qualityKey: string
}

export interface MetadataRevision {
  record: RevisionRecord
  artifacts: RevisionArtifacts
}

export interface MetadataAsset {
  workspaceId: string
  asset: LibraryAsset
  version: number
}

export interface AuditEventInput {
  action: LibraryAction
  actor: WorkspacePrincipal
  assetId: string
  revision?: string
  detail?: Record<string, string>
}

export interface AuditEvent extends AuditEventInput {
  eventId: string
  occurredAt: string
}

/** Immutable object store: revision payloads may be read but never overwritten. */
export interface ObjectStore {
  putImmutable(key: string, body: string, contentType: string): Promise<void>
  getText(key: string): Promise<string>
}

/**
 * The metadata API owns all state transitions. Its mutation endpoints must
 * commit the data change and supplied audit event in one database transaction.
 */
export interface MetadataRepository {
  getAsset(workspaceId: string, assetId: string): Promise<MetadataAsset | undefined>
  getRevision(workspaceId: string, assetId: string, revision: string): Promise<MetadataRevision | undefined>
  createDraft(input: { workspaceId: string; asset: LibraryAsset; revision: MetadataRevision; audit: AuditEventInput }): Promise<void>
  preview(input: { workspaceId: string; assetId: string; revision: string; audit: AuditEventInput }): Promise<MetadataRevision>
  release(input: { workspaceId: string; assetId: string; revision: string; approvalId: string; audit: AuditEventInput }): Promise<ReleasePointer>
  rollback(input: { workspaceId: string; assetId: string; revision: string; approvalId: string; audit: AuditEventInput }): Promise<ReleasePointer>
  getRelease(workspaceId: string, assetId: string): Promise<ReleasePointer | undefined>
  appendAudit(event: AuditEventInput): Promise<void>
  listAudit(workspaceId: string, assetId: string): Promise<AuditEvent[]>
}

export class WorkspaceAuthorizer {
  assert(principal: WorkspacePrincipal, action: LibraryAction): void {
    const roles = new Set(principal.roles)
    if (roles.has('owner') || roles.has('admin')) return
    const allowed = action === 'dashboard.read'
      ? roles.has('viewer') || roles.has('editor')
      : action === 'dashboard.draft.create' || action === 'dashboard.preview'
        ? roles.has('editor')
        : false
    if (!allowed) throw new Error(`RBAC_DENIED:${action}`)
  }
}

/** Local-only identity for CLI/tests. Production replaces it with signed host context. */
export class StaticIdentityProvider implements IdentityProvider {
  constructor(private readonly principal?: WorkspacePrincipal) {}

  async current(): Promise<WorkspacePrincipal> {
    if (!this.principal) throw new Error('IDENTITY_REQUIRED: configure a trusted host identity provider')
    return this.principal
  }
}
