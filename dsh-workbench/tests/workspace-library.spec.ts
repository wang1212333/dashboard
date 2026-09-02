import { describe, expect, it } from 'vitest'
import { InMemoryMetadataRepository, InMemoryObjectStore } from '../src/library/in-memory-adapters.js'
import { StaticIdentityProvider } from '../src/library/ports.js'
import { WorkspaceKnowledgeLibrary } from '../src/library/workspace-library.js'

const csv = `date,category,planned,published,views,conversions,revenue
2026-08-17,种草内容,2,2,1000,50,1000
2026-08-18,教程内容,2,1,500,10,300`

function createLibrary(role: 'owner' | 'admin' | 'editor' | 'viewer', metadata = new InMemoryMetadataRepository(), objects = new InMemoryObjectStore()) {
  return {
    library: new WorkspaceKnowledgeLibrary(objects, metadata, new StaticIdentityProvider({ userId: 'user-001', workspaceId: 'team-alpha', roles: [role], requestId: 'req-001' })),
    metadata,
    objects,
  }
}

describe('WorkspaceKnowledgeLibrary', () => {
  it('stores immutable objects while metadata owns lifecycle, workspace scope and audit', async () => {
    const { library, metadata, objects } = createLibrary('owner')
    const draft = await library.buildDraft(csv, { assetId: 'content-weekly', displayName: '团队内容周报' })
    expect(draft.revision).toMatchObject({ revision: 'rev-0001', stage: 'draft' })
    await expect(objects.getText('workspaces/team-alpha/assets/content-weekly/revisions/rev-0001/dashboard.html')).resolves.toContain('内容运营周看板')
    await library.preview('content-weekly', 'rev-0001')
    await library.release('content-weekly', 'rev-0001', { approvalId: 'approval-001' })
    await expect(library.getRelease('content-weekly')).resolves.toMatchObject({ revision: { stage: 'released', revision: 'rev-0001' } })
    const events = await metadata.listAudit('team-alpha', 'content-weekly')
    expect(events.map((event) => event.action)).toEqual(expect.arrayContaining(['dashboard.draft.create', 'dashboard.preview', 'dashboard.release', 'dashboard.read']))
    expect(events.every((event) => event.actor.userId === 'user-001')).toBe(true)
  })

  it('enforces role boundaries and never accepts user identity from tool input', async () => {
    const metadata = new InMemoryMetadataRepository()
    const objects = new InMemoryObjectStore()
    const editor = createLibrary('editor', metadata, objects).library
    await editor.buildDraft(csv, { assetId: 'content-weekly' })
    await editor.preview('content-weekly', 'rev-0001')
    await expect(editor.release('content-weekly', 'rev-0001', { approvalId: 'approval-001' })).rejects.toThrow('RBAC_DENIED:dashboard.release')
    const owner = createLibrary('owner', metadata, objects).library
    await owner.release('content-weekly', 'rev-0001', { approvalId: 'approval-001' })
    const viewer = createLibrary('viewer', metadata, objects).library
    await expect(viewer.getRelease('content-weekly')).resolves.toMatchObject({ asset: { assetId: 'content-weekly' } })
    await expect(viewer.buildDraft(csv, { assetId: 'another-board' })).rejects.toThrow('RBAC_DENIED:dashboard.draft.create')
  })

  it('requires an opaque host approval before external lifecycle transitions', async () => {
    const { library } = createLibrary('owner')
    await library.buildDraft(csv, { assetId: 'content-weekly' })
    await library.preview('content-weekly', 'rev-0001')
    await expect(library.release('content-weekly', 'rev-0001')).rejects.toThrow('APPROVAL_REQUIRED')
  })
})
