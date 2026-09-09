import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { submitNativeSession } from '../src/native-session-bridge.js'
import { NativeWorkbenchSessions } from '../src/native-workbench-sessions.js'
import { makeWorkbenchWebRoutes } from '../src/web-ui/host-routes.js'
import { FilesystemKnowledgeLibrary } from '../src/library/filesystem-library.js'
import { registerWorkbenchTools } from '../src/tools.js'
import { HeadlessDashboardAgentService } from '../src/headless-dashboard-agent.js'

const id = 'session-11111111-1111-1111-1111-111111111111'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function temp() { const root = await mkdtemp(join(tmpdir(), 'native-workbench-')); roots.push(root); return root }
function fixture() {
  const driver = { rename: vi.fn(async () => {}), prompt: vi.fn(async () => ({ ok: true as const })) }
  const sessions = { list: { getSnapshot: () => ({ byId: { [id]: { cwd: 'E:/real-project' } } }) }, create: vi.fn(async () => id), binding: vi.fn(() => ({ session: driver })), open: vi.fn() }
  const workspaces = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'real-workspace', path: 'E:/real-project' }], recentWorkspaceId: 'real-workspace' }) }, connectWorkspace: vi.fn(async () => id) }
  const input = { title: '原生任务', prepare: vi.fn(async () => '真实需求'), onBound: vi.fn() }
  return { driver, sessions, workspaces, input }
}
describe('native DSH handoff', () => {
  it('uses the real Workspace and native prompt/open without creating an Agent', async () => {
    const f = fixture()
    expect(await submitNativeSession(f.input, f.sessions, f.workspaces)).toBe(id)
    expect(f.workspaces.connectWorkspace).not.toHaveBeenCalled()
    expect(f.sessions.create).toHaveBeenCalledWith({workspaceId:'real-workspace',sessionId:expect.stringMatching(/^session-/)})
    expect(f.driver.prompt).toHaveBeenCalledExactlyOnceWith([{ type: 'text', text: '真实需求' }], 'queue')
    expect(f.sessions.open).toHaveBeenCalledWith(id)
    expect(f.input.onBound.mock.invocationCallOrder[0]).toBeLessThan(f.input.prepare.mock.invocationCallOrder[0])
  })
  it('restores exactly the original session across another bridge instance', async () => {
    const f = fixture()
    await submitNativeSession({ ...f.input, sessionId: id }, f.sessions, f.workspaces)
    expect(f.workspaces.connectWorkspace).not.toHaveBeenCalled()
    expect(f.driver.rename).not.toHaveBeenCalled()
    expect(f.sessions.binding).toHaveBeenCalledWith(id)
  })
  it('fails loudly for missing original sessions without replacement', async () => {
    const f = fixture()
    await expect(submitNativeSession({ ...f.input, sessionId: id }, { ...f.sessions, binding: () => undefined }, f.workspaces)).rejects.toThrow('不会创建替代会话')
    expect(f.workspaces.connectWorkspace).not.toHaveBeenCalled()
    expect(f.driver.prompt).not.toHaveBeenCalled()
  })
  it('does not continue legacy headless sessions in an upload directory', async () => {
    const f = fixture()
    const sessions = { ...f.sessions, list: { getSnapshot: () => ({ byId: { [id]: { cwd: 'C:/library/agent-inputs/upload' } } }) } }
    await expect(submitNativeSession({ ...f.input, sessionId: id }, sessions, f.workspaces)).rejects.toThrow('旧版后台会话')
    expect(f.driver.prompt).not.toHaveBeenCalled()
    expect(f.workspaces.connectWorkspace).not.toHaveBeenCalled()
  })
  it('retains the id but does not submit on preparation failure', async () => {
    const f = fixture()
    await expect(submitNativeSession({ ...f.input, prepare: async () => { throw new Error('upload missing') } }, f.sessions, f.workspaces)).rejects.toThrow('upload missing')
    expect(f.input.onBound).toHaveBeenCalledWith(id)
    expect(f.driver.prompt).not.toHaveBeenCalled()
  })
  it('reports native prompt rejection rather than claiming completion', async () => {
    const f = fixture()
    const session = { ...f.driver, prompt: async () => ({ ok: false as const, error: 'native unavailable' }) }
    await expect(submitNativeSession(f.input, { ...f.sessions, binding: () => ({ session }) }, f.workspaces)).rejects.toThrow('native unavailable')
  })
})

it('persists attachment references and draft delivery; isolates uploads by native session', async () => {
  const root = await temp(), links = new NativeWorkbenchSessions(root)
  const upload = await links.uploads.saveCsv('first.csv', 'region,sales\nEast,100')
  await links.bind(id, upload.uploadId)
  const next = await links.uploads.saveCsv('next.csv', 'region,sales\nWest,200')
  await Promise.all([links.bind(id, next.uploadId), links.recordDraft(id, { assetId: 'native-test', revision: 'rev-0001', title: 'Native test' })])
  const restarted = new NativeWorkbenchSessions(root)
  expect((await restarted.dataset(id, upload.uploadId))?.csv).toContain('East,100')
  expect((await restarted.dataset(id))?.csv).toContain('West,200')
  expect((await restarted.read(id))?.draft?.assetId).toBe('native-test')
  await expect(restarted.dataset(id, '22222222-2222-2222-2222-222222222222')).rejects.toThrow('UPLOAD_NOT_ATTACHED')
  await expect(restarted.read('../escape')).rejects.toThrow('SESSION_ID_INVALID')
})

it('connects upload, template, native tools, draft preview and explicit publication through host routes', async () => {
  const root = await temp(), links = new NativeWorkbenchSessions(root), library = new FilesystemKnowledgeLibrary(root)
  const registered = new Map<string, any>()
  const ctx = { tools: { register: (tool: any) => registered.set(tool.name, tool) }, on: vi.fn() }
  new HeadlessDashboardAgentService(ctx as never, root, links)
  registerWorkbenchTools(ctx as never, library, links)
  const headless = { create: vi.fn(), exists: () => false } as any
  const route = makeWorkbenchWebRoutes(library, undefined, root, headless, links).find(route => route.path === '/api/dsh-workbench')!
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const post = async (path: string, body: unknown) => {
    const response = await fetch(origin + '/api/dsh-workbench' + path, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  try {
    const upload = await post('/uploads', { fileName: 'sales.csv', csv: 'region,sales\nEast,100' })
    const prepared = await post('/native-session-input', { requestId: 'test-input-1', sessionId: id, uploadId: upload.body.uploadId, prompt: '搭建看板', designTemplateId: 'lieflat-r09' })
    expect(prepared.status).toBe(200)
    expect(prepared.body.prompt).toBe('搭建看板')
    expect((await links.read(id))?.inputs?.[0]).toMatchObject({ prompt: '搭建看板', templateId: 'lieflat-r09', uploadId: upload.body.uploadId })
    expect(headless.create).not.toHaveBeenCalled()
    expect((await post('/dashboard-agent-sessions', {})).status).toBe(409)
    expect((await post('/dashboard-agent-sessions/' + id + '/messages', { mode: 'background', prompt: 'test' })).status).not.toBe(200)
    expect(headless.create).not.toHaveBeenCalled()
    const execution = { agent: { id, session: { id } } }
    const dataset = await registered.get('workbench_read_attached_dataset').execute({ uploadId: upload.body.uploadId }, execution)
    expect(dataset.rowCount).toBe(1)
    const draft = await registered.get('workbench_save_generated_dashboard').execute({ assetId: 'native-test', title: 'Native test', html: '<!doctype html><html><body><h1>Sales</h1><p>East 100</p></body></html>' }, execution)
    expect(draft.workbenchUrl).toContain('nativeSession=' + id)
    expect((await links.read(id))?.draft).toMatchObject({ assetId: 'native-test', revision: 'rev-0001' })
    expect(draft.revision.stage).toBe('draft')
    expect((await post('/dashboard-drafts/native-test/rev-0001/release', {})).status).not.toBe(200)
    expect((await post('/dashboard-drafts/native-test/rev-0001/preview', {})).status).toBe(200)
    expect((await post('/dashboard-drafts/native-test/rev-0001/release', { confirmed: true })).status).toBe(200)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
