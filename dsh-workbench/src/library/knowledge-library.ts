import type { BuildDashboardOptions } from '../dashboard-build/build.js'
import type { LibraryAsset, ReleasePointer, StoredDashboardRevision } from './contracts.js'

export interface LifecycleCommand {
  /** Opaque host-issued approval. The metadata service validates it atomically with the transition. */
  approvalId?: string
}

/** Storage-agnostic dashboard lifecycle API used by DSH tools. */
export interface KnowledgeLibrary {
  buildDraft(csv: string, options: BuildDashboardOptions): Promise<StoredDashboardRevision>
  preview(assetId: string, revision?: string): Promise<StoredDashboardRevision>
  release(assetId: string, revision?: string, command?: LifecycleCommand): Promise<ReleasePointer>
  rollback(assetId: string, targetRevision: string, command?: LifecycleCommand): Promise<ReleasePointer>
  getRelease(assetId: string): Promise<StoredDashboardRevision>
  readRevision(assetId: string, revision?: string): Promise<StoredDashboardRevision>
  getAsset(assetId: string): Promise<LibraryAsset>
}
