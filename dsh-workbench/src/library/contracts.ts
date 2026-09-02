import type { DashboardManifest, DashboardModel, DataQualityReport } from '../dashboard-build/contracts.js'

export type RevisionStage = 'draft' | 'preview' | 'released'

export interface LibraryAsset {
  assetId: string
  displayName: string
  source: DashboardManifest['source']
  templateId: string
  dataContract: DashboardManifest['dataContract']
  createdAt: string
  updatedAt: string
  latestRevision: string
  releasedRevision?: string
}

export interface RevisionRecord {
  assetId: string
  revision: string
  stage: RevisionStage
  createdAt: string
  updatedAt: string
  quality: DataQualityReport
}

export interface StoredDashboardRevision {
  asset: LibraryAsset
  revision: RevisionRecord
  manifest: DashboardManifest
  quality: DataQualityReport
  model: DashboardModel
  html: string
}

export interface ReleasePointer {
  assetId: string
  revision: string
  releasedAt: string
  reason: 'release' | 'rollback'
}
