import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { myDashboardsBehavior } from '../src/local-app/my-dashboards-live.js'

function mount(href: string) {
  const behavior = myDashboardsBehavior()
  const start = behavior.indexOf("(()=>{const host=document.getElementById('page-content');if(!host)return;const escape=")
  expect(start).toBeGreaterThan(-1)
  const script = behavior.slice(start, behavior.indexOf('})()', start) + 4)
  const host = { innerHTML: '', querySelector: () => null }
  const listeners: Record<string, (event: unknown) => void> = {}
  const item = { id: 'example', title: 'Example', status: 'draft', sourceConversationId: 'session-1', dashboardUrl: '/dsh-workbench/assets/example/rev-0001/dashboard.html' }
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ dashboards: [item] }) }))
  runInNewContext(script, {
    document: { getElementById: () => host, addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener } },
    location: { href, pathname: new URL(href).pathname },
    history: { pushState: vi.fn() }, URL, fetch,
  })
  return { host, listeners, fetch, item }
}

describe('dashboard viewer routing', () => {
  it('opens a loaded card without a redundant list request and preserves draft metadata', () => {
    const { listeners, host, fetch, item } = mount('http://localhost/dsh-workbench?section=boards')
    listeners['dsh:open-dashboard']({ detail: item })
    expect(fetch).not.toHaveBeenCalled()
    expect(host.innerHTML).toContain(item.dashboardUrl)
    expect(host.innerHTML).toContain('继续搭建 / 发布')
    expect(myDashboardsBehavior()).toContain('status:x.status,sourceConversationId:x.sourceConversationId')
  })

  it.each([
    ['/dsh-workbench?embedded=2&viewer=example', '/api/dsh-workbench/dashboards?includeDrafts=true'],
    ['/?viewer=example', '/api/dashboards?includeDrafts=true'],
  ])('restores a viewer from %s with the correct API', async (path, api) => {
    const { fetch, host, item } = mount('http://localhost' + path)
    await vi.waitFor(() => expect(host.innerHTML).toContain('dashboard-viewer-frame'))
    expect(fetch).toHaveBeenCalledWith(api)
    expect(host.innerHTML).toContain(item.dashboardUrl)
  })
})
