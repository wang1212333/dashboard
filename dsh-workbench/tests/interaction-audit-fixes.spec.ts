import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, expect, it } from 'vitest'
import { FilesystemKnowledgeLibrary } from '../src/library/filesystem-library.js'
import { dashboardCatalog, dashboardVersions } from '../src/local-app/dashboard-catalog.js'
import { NativeWorkbenchSessions } from '../src/native-workbench-sessions.js'
import { exportNativeConversation } from '../src/native-conversation-export.js'
import { conversationSnapshot } from '../src/local-app/conversation-share.js'
import { renderLocalWorkbenchPage } from '../src/local-app/page.js'

const roots: string[] = []
it('preserves history order through native restore, status snapshot and delivery hydration', async () => {
  const page = renderLocalWorkbenchPage()
  const fn = (name: string, next: string) => page.slice(page.indexOf('function '+name+'('), page.indexOf(next, page.indexOf('function '+name+'(')))
  const listeners: Array<(event: unknown) => void> = []
  const state = { sessionId: 'old', requestId: 'request', history: [
    { sessionId: 'new', title: 'New', createdAt: 200, activityAt: 200 },
    { sessionId: 'old', title: 'Old', createdAt: 100, activityAt: 100 },
  ], stream: { nativeSessionId: 'old' }, nativeRunning: undefined }
  const parent = {}, context = { state, Date, window: { parent, addEventListener: (_: string, listener: (event: unknown) => void) => listeners.push(listener) },
    location: { origin: 'http://localhost' }, document: { querySelector: () => ({}) }, saveHistory: () => {}, renderHistory: () => {},
    dashboardAgentApi: () => '/api', fetch: async () => ({ status: 200, ok: true, json: async () => ({ uploadId: 'upload' }) }),
    renderConversationUpdate: (touch: boolean) => runInNewContext('persistActiveHistory('+touch+')', context) }
  runInNewContext(fn('persistActiveHistory', 'function restoreHistory') + fn('ensureConversationHistory', '\n  const isCurrentUpload=') +
    'async '+fn('loadNativeDelivery', '  const nativeAgentAnswer=') +
    page.slice(page.indexOf('refreshStream=function('), page.indexOf('  agentAnswer=function', page.indexOf('refreshStream=function('))) +
    page.slice(page.indexOf("  window.addEventListener('message',event=>{\n    const data=event.data||{};"), page.indexOf('  const nativeReturnSession=')), context)
  const dispatch = (data: Record<string, unknown>) => listeners.forEach(listener => listener({ source: parent, origin: 'http://localhost', data: { source: 'dsh-workbench', requestId: 'request', sessionId: 'old', ...data } }))
  dispatch({ kind: 'native-session-restored' })
  dispatch({ kind: 'native-session-state', running: false })
  await runInNewContext("loadNativeDelivery('old')", context)
  expect([...state.history].sort((a,b) => b.activityAt-a.activityAt).map(item => item.sessionId)).toEqual(['new','old'])
  expect(state.history.find(item => item.sessionId === 'old')?.activityAt).toBe(100)
  dispatch({ kind: 'native-session-started' })
  expect(state.history.find(item => item.sessionId === 'old')!.activityAt).toBeGreaterThan(200)
})
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const csv = 'date,category,planned,published,views,conversions,revenue\n2026-08-17,Test,2,2,1000,50,1000'

it('lists real drafts, versions and source sessions while retaining released-only default semantics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-catalog-')); roots.push(root)
  const library = new FilesystemKnowledgeLibrary(root), sessions = new NativeWorkbenchSessions(root)
  const sessionId = 'session-11111111-1111-1111-1111-111111111111'
  await sessions.bind(sessionId)
  await library.buildDraft(csv, { assetId: 'audit-draft', displayName: 'Test' })
  await sessions.recordDraft(sessionId, { assetId: 'audit-draft', revision: 'rev-0001', title: 'Test' })
  expect(await dashboardCatalog(library, '/dsh-workbench', false, sessions)).toEqual([])
  expect(await dashboardCatalog(library, '/dsh-workbench', true, sessions)).toMatchObject([{ status: 'draft', currentVersion: 1, sourceConversationId: sessionId }])
  await library.preview('audit-draft'); await library.release('audit-draft')
  await library.buildDraft(csv, { assetId: 'audit-draft' })
  expect(await dashboardCatalog(library, '', false)).toMatchObject([{ revision: 'rev-0001', status: 'published' }])
  expect(await dashboardCatalog(library, '', true)).toMatchObject([{ revision: 'rev-0002', status: 'draft', releasedRevision: 'rev-0001' }])
  expect((await dashboardVersions(library, 'audit-draft', '')).versions).toMatchObject([{ revision: 'rev-0002', stage: 'draft' }, { revision: 'rev-0001', current: true }])
})

it('exports finalized native public text across history pages, excluding reasoning/tools/context', async () => {
  let loaded = false
  const messages = await exportNativeConversation({ open: async () => {}, loadOlder: async () => { loaded = true }, getSnapshot: () => ({ hasMore: !loaded, running: false,
    nodes: [...(loaded ? [{ kind: 'user', content: [{ type: 'text', text: 'Original question' }] }] : []),
      { kind: 'context', content: [{ type: 'text', text: 'PRIVATE' }] },
      { kind: 'assistant', blocks: [{ kind: 'reasoning', text: 'PRIVATE' }, { kind: 'text', text: 'Answer' }, { kind: 'tool-call', text: 'PRIVATE' }] }] }) })
  expect(messages).toEqual([{ role: 'user', text: 'Original question' }, { role: 'assistant', text: 'Answer' }])
  expect(conversationSnapshot({ title: 'Native', messages }).messages).toEqual(messages)
})

it('fails closed on incomplete or running native history', async () => {
  await expect(exportNativeConversation({ getSnapshot: () => ({ running: true }) })).rejects.toThrow('等待')
  await expect(exportNativeConversation({ getSnapshot: () => ({ hasMore: true, nodes: [] }), loadOlder: async () => {} })).rejects.toThrow('加载失败')
})

it('keeps generated browser scripts valid and replaces misleading interactions', () => {
  const page = renderLocalWorkbenchPage()
  for (const part of page.split('<script>').slice(1)) expect(() => new Function(part.split('</script>')[0])).not.toThrow()
  for (const token of ['templateRemoving', 'selectionState', '取消失败，请重试', 'data-clear-filters', 'showVersions', 'dsh.dashboard-workbench.favorites', 'workbench-route', 'native-conversation-exported']) expect(page.includes(token), token).toBe(true)
  expect(page.includes("querySelector('.dash-grid,.dash-list')")).toBe(true)
  expect(page.includes("status:'published',currentVersion:1")).toBe(false)
  expect(page.includes("toast('正在以只读方式查看历史版本')")).toBe(false)
  expect(page.includes('data-agent="经营分析智能体"')).toBe(false)
  expect(page.includes('function persistActiveHistory(touchActivity=true)')).toBe(true)
  expect(page.includes("persistActiveHistory(false);render();renderHistory();return}if(data.kind==='history-load-failed'")).toBe(true)
  expect(page.includes("history-load-failed'){state.activity=typeof data.message==='string'?data.message:state.activity;refreshStream(false)")).toBe(true)
})
