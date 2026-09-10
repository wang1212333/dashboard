import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { renderLocalWorkbenchPage } from '../src/local-app/page.js'

it('guides an unpreviewed draft to preview, then requires confirmation to release', async () => {
  const page = renderLocalWorkbenchPage()
  const start = page.indexOf("document.addEventListener('click',async event=>{\n    const button=")
  expect(start).toBeGreaterThan(-1)
  const script = page.slice(start, page.indexOf('},true);', start) + 8)
  let handler: (event: unknown) => Promise<void>
  const draft = { assetId: 'test', revision: 'rev-0001', previewed: false, released: false }
  const state = { sessionId: 's1', draftActionBusy: false, stream: { dashboardDraft: draft } }
  const button = { disabled: false, isConnected: false, dataset: { releaseDraft: 'test', draftRevision: 'rev-0001' }, hasAttribute: () => true, setAttribute: vi.fn() }
  class Target { closest() { return button } }
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ previewUrl: '/preview' }) }))
  const confirm = vi.fn(() => false)
  runInNewContext(script, { document: { addEventListener: (_: string, fn: typeof handler) => { handler = fn } }, Element: Target, state, fetch, confirm, dashboardAgentApi: () => '/api', AbortSignal, historyToast: vi.fn(), refreshStream: vi.fn(), window: { open: () => ({ opener: {}, location: { assign: vi.fn() } }) } })
  const event = { target: new Target(), preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
  await handler!(event)
  expect(fetch.mock.calls[0][0]).toBe('/api/dashboard-drafts/test/rev-0001/preview')
  expect(draft.previewed).toBe(true)
  expect(draft.released).toBe(false)
  expect(state.draftActionBusy).toBe(false)
  button.disabled = false
  await handler!(event)
  expect(confirm).toHaveBeenCalledOnce()
  expect(fetch).toHaveBeenCalledTimes(1)
  confirm.mockReturnValue(true)
  await handler!(event)
  expect(fetch.mock.calls[1][0]).toBe('/api/dashboard-drafts/test/rev-0001/release')
  expect(draft.released).toBe(true)
})
