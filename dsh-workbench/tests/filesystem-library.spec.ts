import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FilesystemKnowledgeLibrary } from '../src/library/filesystem-library.js'

const csv = `date,category,planned,published,views,conversions,revenue
2026-08-17,种草内容,2,2,1000,50,1000
2026-08-18,教程内容,2,1,500,10,300`
const roots: string[] = []

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function createLibrary(): Promise<FilesystemKnowledgeLibrary> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-library-'))
  roots.push(root)
  return new FilesystemKnowledgeLibrary(root)
}

describe('FilesystemKnowledgeLibrary', () => {
  it('writes an immutable Draft revision with all dashboard artifacts', async () => {
    const library = await createLibrary()
    const stored = await library.buildDraft(csv, { assetId: 'content-weekly', displayName: '内容周报' })
    expect(stored.revision).toMatchObject({ revision: 'rev-0001', stage: 'draft' })
    expect(await readFile(join((roots[0]), 'assets', 'content-weekly', 'revisions', 'rev-0001', 'dashboard.html'), 'utf8')).toContain('内容运营周看板')
  })

  it('preserves immutable HTML revisions without a publication transition', async () => {
    const library = await createLibrary()
    const first = await library.buildDraft(csv, { assetId: 'content-weekly' })
    const second = await library.buildDraft(csv, { assetId: 'content-weekly' })
    expect(second.revision.revision).toBe('rev-0002')
    expect(await library.readRevision('content-weekly', first.revision.revision)).toMatchObject({ revision: { revision: 'rev-0001', stage: 'draft' } })
  })
})
