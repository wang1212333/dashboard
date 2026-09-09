import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { DesignTemplateLibrary, toBrowserTemplate } from '../src/design-library/design-template-library.js'
import { TemplateCoverLibrary } from '../src/design-library/template-cover-library.js'
import { makeWorkbenchWebRoutes } from '../src/web-ui/host-routes.js'
import type { KnowledgeLibrary } from '../src/library/knowledge-library.js'
import type { HeadlessDashboardAgentService } from '../src/headless-dashboard-agent.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function temp() { const root = await mkdtemp(join(tmpdir(), 'lieflat-test-')); roots.push(root); return root }

it('keeps all 18 bundled templates available offline with real covers, sources and isolated previews', async () => {
  const root = await temp()
  const library = new DesignTemplateLibrary({ cacheRoot: root, fetch: vi.fn(async () => { throw new Error('offline') }) })
  const result = await library.listResult()
  expect(result.templates).toHaveLength(18)
  expect(result.templates.filter(item => item.kind === 'report')).toHaveLength(12)
  const covers = new TemplateCoverLibrary({ cacheRoot: root })
  const cards = await covers.cards(result.templates)
  expect(cards.every(card => card.status === 'ready')).toBe(true)
  for (const card of cards) {
    expect((await covers.cover(card))?.subarray(0, 4).toString()).toBe('RIFF')
    expect(await covers.preview(card)).toContain('sandbox="allow-scripts"')
  }
  const detail = await library.get('lieflat-r09')
  const source = await readFile(new URL('../src/design-library/lieflat-assets/templates/reports/report-09.zh.html', import.meta.url), 'utf8')
  expect(detail.content).toContain(source)
  expect(toBrowserTemplate(detail).styleGuide).not.toContain('<!doctype')
  await expect(library.get('lieflat-../../LICENSE')).rejects.toThrow('INVALID')
})

it('passes the selected original template through the real message route and supports explicit clearing', async () => {
  let listener: (event: any) => void = () => {}
  const send = vi.fn(() => listener({ type: 'agent.completed', data: {} }))
  const agents = { exists: () => true, subscribe: (_id: string, callback: typeof listener) => { listener = callback; return () => {} }, send }
  const routes = makeWorkbenchWebRoutes({} as KnowledgeLibrary, undefined, await temp(), agents as unknown as HeadlessDashboardAgentService)
  const route = routes.find(route => route.path === '/api/dsh-workbench')!
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/api/dsh-workbench/dashboard-agent-sessions/11111111-1111-1111-1111-111111111111/messages`
  try {
    for (const id of ['lieflat-r09', '']) {
      const response = await fetch(url, { method: 'POST', headers: { origin: `http://127.0.0.1:${address.port}`, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'background', prompt: '分析销售数据', clientRenderVersion: 2, designTemplateId: id }) })
      expect(await response.text()).toContain('agent.completed')
    }
    expect(send.mock.calls[0]?.[1]).toContain('<selected-template-source>')
    expect(send.mock.calls[0]?.[1]).toContain('数据故事仪表盘')
    expect(send.mock.calls[1]?.[1]).toBe('分析销售数据')
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
