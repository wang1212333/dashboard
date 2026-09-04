import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildDashboardFromCsv, type BuildDashboardOptions } from '../dashboard-build/build.js'
import { buildAgentNativeDashboard, type AgentNativeDashboardInput } from '../dashboard-build/agent-native.js'
import type { DashboardManifest } from '../dashboard-build/contracts.js'
import type { LibraryAsset, ReleasePointer, RevisionRecord, StoredDashboardRevision } from './contracts.js'
import type { KnowledgeLibrary, LifecycleCommand } from './knowledge-library.js'

const ASSET_ID = /^[a-z][a-z0-9-]{2,62}$/

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, path)
}

export class FilesystemKnowledgeLibrary implements KnowledgeLibrary {
  constructor(private readonly root: string) {}

  async buildDraft(csv: string, options: BuildDashboardOptions): Promise<StoredDashboardRevision> {
    this.assertAssetId(options.assetId)
    const previousAsset = await this.tryReadAsset(options.assetId)
    const previousManifest = previousAsset ? await this.readManifest(options.assetId, previousAsset.latestRevision) : undefined
    const result = buildDashboardFromCsv(csv, { ...options, previousManifest })
    const asset = this.toAsset(result.manifest, previousAsset)
    const revision: RevisionRecord = { assetId: asset.assetId, revision: result.manifest.revision, stage: 'draft', createdAt: result.manifest.updatedAt, updatedAt: result.manifest.updatedAt, quality: result.quality }
    const revisionDirectory = this.revisionDirectory(asset.assetId, revision.revision)
    if (await exists(revisionDirectory)) throw new Error(`REVISION_ALREADY_EXISTS:${revision.revision}`)
    const temporaryDirectory = `${revisionDirectory}.tmp-${process.pid}`
    await mkdir(temporaryDirectory, { recursive: true })
    try {
      await Promise.all([
        writeFile(join(temporaryDirectory, 'dashboard.html'), result.html, 'utf8'),
        writeFile(join(temporaryDirectory, 'manifest.json'), JSON.stringify(result.manifest, null, 2), 'utf8'),
        writeFile(join(temporaryDirectory, 'quality.json'), JSON.stringify(result.quality, null, 2), 'utf8'),
        writeFile(join(temporaryDirectory, 'model.json'), JSON.stringify(result.model, null, 2), 'utf8'),
        writeFile(join(temporaryDirectory, 'revision.json'), JSON.stringify(revision, null, 2), 'utf8'),
      ])
      await rename(temporaryDirectory, revisionDirectory)
      await writeJsonAtomic(this.assetPath(asset.assetId), asset)
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true })
      throw error
    }
    return { asset, revision, manifest: result.manifest, quality: result.quality, model: result.model, html: result.html }
  }

  async buildAgentNativeDraft(input: AgentNativeDashboardInput): Promise<StoredDashboardRevision> {
    this.assertAssetId(input.assetId)
    const previousAsset = await this.tryReadAsset(input.assetId)
    const previousManifest = previousAsset ? await this.readManifest(input.assetId, previousAsset.latestRevision) : undefined
    const result = buildAgentNativeDashboard({ ...input, previousManifest })
    const asset = this.toAsset(result.manifest, previousAsset)
    const revision: RevisionRecord = { assetId: asset.assetId, revision: result.manifest.revision, stage: 'draft', createdAt: result.manifest.updatedAt, updatedAt: result.manifest.updatedAt, quality: result.quality }
    const revisionDirectory = this.revisionDirectory(asset.assetId, revision.revision)
    if (await exists(revisionDirectory)) throw new Error(`REVISION_ALREADY_EXISTS:${revision.revision}`)
    const temporaryDirectory = `${revisionDirectory}.tmp-${process.pid}`
    await mkdir(temporaryDirectory, { recursive: true })
    try {
      await Promise.all([
        writeFile(join(temporaryDirectory, 'dashboard.html'), result.html, 'utf8'),
        writeFile(join(temporaryDirectory, 'manifest.json'), JSON.stringify(result.manifest, null, 2), 'utf8'),
        writeFile(join(temporaryDirectory, 'quality.json'), JSON.stringify(result.quality, null, 2), 'utf8'),
        writeFile(join(temporaryDirectory, 'model.json'), JSON.stringify(result.model, null, 2), 'utf8'),
        writeFile(join(temporaryDirectory, 'revision.json'), JSON.stringify(revision, null, 2), 'utf8'),
      ])
      await rename(temporaryDirectory, revisionDirectory)
      await writeJsonAtomic(this.assetPath(asset.assetId), asset)
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true })
      throw error
    }
    return { asset, revision, manifest: result.manifest, quality: result.quality, model: result.model, html: result.html }
  }

  async preview(assetId: string, revision?: string): Promise<StoredDashboardRevision> {
    const stored = await this.readRevision(assetId, revision)
    if (stored.revision.stage === 'released') return stored
    if (stored.revision.stage === 'preview') return stored
    if (stored.revision.stage !== 'draft') throw new Error(`PREVIEW_NOT_ALLOWED:${stored.revision.stage}`)
    const updated = { ...stored.revision, stage: 'preview' as const, updatedAt: new Date().toISOString() }
    await writeJsonAtomic(this.revisionPath(assetId, stored.revision.revision), updated)
    return { ...stored, revision: updated }
  }

  async release(assetId: string, revision?: string, _command?: LifecycleCommand): Promise<ReleasePointer> {
    const stored = await this.readRevision(assetId, revision)
    if (stored.revision.stage !== 'preview') throw new Error('RELEASE_REQUIRES_PREVIEW')
    const updated = { ...stored.revision, stage: 'released' as const, updatedAt: new Date().toISOString() }
    const pointer: ReleasePointer = { assetId, revision: updated.revision, releasedAt: updated.updatedAt, reason: 'release' }
    const asset = { ...stored.asset, releasedRevision: updated.revision, updatedAt: updated.updatedAt }
    await writeJsonAtomic(this.revisionPath(assetId, updated.revision), updated)
    await writeJsonAtomic(this.releasePath(assetId), pointer)
    await writeJsonAtomic(this.assetPath(assetId), asset)
    return pointer
  }

  async rollback(assetId: string, targetRevision: string, _command?: LifecycleCommand): Promise<ReleasePointer> {
    const target = await this.readRevision(assetId, targetRevision)
    if (target.revision.stage === 'draft') throw new Error('ROLLBACK_REQUIRES_PREVIEW_OR_RELEASED_REVISION')
    const now = new Date().toISOString()
    const pointer: ReleasePointer = { assetId, revision: target.revision.revision, releasedAt: now, reason: 'rollback' }
    const asset = { ...target.asset, releasedRevision: target.revision.revision, updatedAt: now }
    await writeJsonAtomic(this.releasePath(assetId), pointer)
    await writeJsonAtomic(this.assetPath(assetId), asset)
    return pointer
  }

  async getRelease(assetId: string): Promise<StoredDashboardRevision> {
    const pointer = await readJson<ReleasePointer>(this.releasePath(assetId))
    return this.readRevision(assetId, pointer.revision)
  }

  async readRevision(assetId: string, revision?: string): Promise<StoredDashboardRevision> {
    this.assertAssetId(assetId)
    const asset = await this.readAsset(assetId)
    const resolvedRevision = revision ?? asset.latestRevision
    const folder = this.revisionDirectory(assetId, resolvedRevision)
    const [manifest, model, revisionRecord, html] = await Promise.all([
      readJson<DashboardManifest>(join(folder, 'manifest.json')),
      readJson<StoredDashboardRevision['model']>(join(folder, 'model.json')),
      readJson<RevisionRecord>(join(folder, 'revision.json')),
      readFile(join(folder, 'dashboard.html'), 'utf8'),
    ])
    return { asset, manifest, quality: revisionRecord.quality, model, revision: revisionRecord, html }
  }

  async getAsset(assetId: string): Promise<LibraryAsset> { return this.readAsset(assetId) }

  async listAssets(): Promise<LibraryAsset[]> {
    const root = join(this.root, 'assets')
    if (!await exists(root)) return []
    const entries = await readdir(root, { withFileTypes: true })
    const assets = await Promise.all(entries.filter(entry => entry.isDirectory() && ASSET_ID.test(entry.name)).map(async entry => {
      const path = join(root, entry.name, 'asset.json')
      return await exists(path) ? readJson<LibraryAsset>(path) : undefined
    }))
    return assets.filter((asset): asset is LibraryAsset => Boolean(asset)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async deleteAsset(assetId: string): Promise<void> {
    this.assertAssetId(assetId)
    const directory = this.assetDirectory(assetId)
    if (!await exists(this.assetPath(assetId))) throw new Error(`ASSET_NOT_FOUND:${assetId}`)
    await rm(directory, { recursive: true, force: false })
  }

  private async tryReadAsset(assetId: string): Promise<LibraryAsset | undefined> {
    return await exists(this.assetPath(assetId)) ? readJson<LibraryAsset>(this.assetPath(assetId)) : undefined
  }

  private async readAsset(assetId: string): Promise<LibraryAsset> {
    if (!await exists(this.assetPath(assetId))) throw new Error(`ASSET_NOT_FOUND:${assetId}`)
    return readJson<LibraryAsset>(this.assetPath(assetId))
  }

  private async readManifest(assetId: string, revision: string): Promise<DashboardManifest> {
    return readJson<DashboardManifest>(join(this.revisionDirectory(assetId, revision), 'manifest.json'))
  }

  private toAsset(manifest: DashboardManifest, previous?: LibraryAsset): LibraryAsset {
    return { assetId: manifest.assetId, displayName: manifest.displayName, source: manifest.source, templateId: manifest.templateId, dataContract: manifest.dataContract, createdAt: previous?.createdAt ?? manifest.createdAt, updatedAt: manifest.updatedAt, latestRevision: manifest.revision, releasedRevision: previous?.releasedRevision }
  }

  private assertAssetId(assetId: string): void { if (!ASSET_ID.test(assetId)) throw new Error('ASSET_ID_INVALID') }
  private assetDirectory(assetId: string): string { return join(this.root, 'assets', assetId) }
  private assetPath(assetId: string): string { return join(this.assetDirectory(assetId), 'asset.json') }
  private revisionDirectory(assetId: string, revision: string): string { return join(this.assetDirectory(assetId), 'revisions', revision) }
  private revisionPath(assetId: string, revision: string): string { return join(this.revisionDirectory(assetId, revision), 'revision.json') }
  private releasePath(assetId: string): string { return join(this.assetDirectory(assetId), 'release.json') }
}
