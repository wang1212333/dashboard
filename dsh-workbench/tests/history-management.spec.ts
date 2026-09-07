import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkbenchHistoryStore } from '../src/local-app/history-store.js'
import { ConversationShareStore, conversationSnapshot, renderConversationShare } from '../src/local-app/conversation-share.js'
import { startLocalWorkbenchApp, type RunningLocalWorkbenchApp } from '../src/local-app/server.js'

const roots: string[] = [], apps: RunningLocalWorkbenchApp[] = []
const root = async () => { const path = await mkdtemp(join(tmpdir(), 'dsh-history-')); roots.push(path); return path }
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('conversation management persistence', () => {
  it('retains archived and pinned conversations beyond the old 20-entry limit, across restart', async () => {
    const file = join(await root(), 'history.json'), store = new WorkbenchHistoryStore(file)
    const items = Array.from({ length: 35 }, (_, i) => ({ sessionId: 'session-' + i, title: '对话 ' + i, createdAt: i + 1, pinnedAt: i === 0 ? 10 : 0, archivedAt: i === 1 ? 11 : 0 }))
    await store.write(items)
    const restored = await new WorkbenchHistoryStore(file).read()
    expect(restored).toHaveLength(35)
    expect(restored.find(item => item.sessionId === 'session-0')?.pinnedAt).toBe(10)
    expect(restored.find(item => item.sessionId === 'session-1')?.archivedAt).toBe(11)
  })
  it('serializes overlapping writes without a temporary-file collision', async () => {
    const store = new WorkbenchHistoryStore(join(await root(), 'history.json'))
    await Promise.all(Array.from({ length: 8 }, (_, i) => store.write([{ sessionId: 'one', title: '名称 ' + i, createdAt: 1 }])))
    expect((await store.read())[0].title).toBe('名称 7')
  })
})

describe('read-only sharing', () => {
  const item = { title: '<script>title</script>', sessionId: 'private-session-id', turns: [{ stream: { question: '库存情况？', output: '<img src=x onerror=alert(1)>', attachmentName: 'private.csv', tools: [{ path: '/secret/data' }], artifacts: [{ previewUrl: '/private/dashboard' }] } }] }
  it('includes only visible text and safely escapes user and model content', () => {
    const snapshot = conversationSnapshot(item), serialized = JSON.stringify(snapshot), page = renderConversationShare(snapshot)
    for (const secret of ['private-session-id', 'private.csv', '/secret/data', '/private/dashboard']) expect(serialized).not.toContain(secret)
    expect(snapshot.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(page).not.toContain('<script>')
    expect(page).toContain("default-src 'none'")
    expect(() => conversationSnapshot({ title: '空对话' })).toThrow('SHARE_EMPTY')
  })
  it('stores immutable snapshots, validates tokens, and serves the same HTML for downloads', async () => {
    const libraryRoot = await root(), app = await startLocalWorkbenchApp({ libraryRoot, port: 0 }); apps.push(app)
    const response = await fetch(app.url + '/api/history/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item }) })
    expect(response.status).toBe(201)
    const shared = await response.json() as { url: string; html: string }
    expect(shared.url).toMatch(/^\/share\/[a-f0-9]{48}$/)
    expect(await (await fetch(app.url + shared.url)).text()).toBe(shared.html)
    const store = new ConversationShareStore(join(libraryRoot, 'history', 'shares'))
    expect(await store.read('../history')).toBeNull()
    expect((await fetch(app.url + '/share/' + 'a'.repeat(48))).status).toBe(404)
    await fetch(app.url + '/api/history', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ history: [] }) })
    expect(await (await fetch(app.url + shared.url)).text()).toBe(shared.html)
  })
})
