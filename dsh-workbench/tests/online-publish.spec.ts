import { afterEach, expect, it, vi } from 'vitest'
import { publishOnline } from '../src/local-app/online-publish.js'
import type { KnowledgeLibrary } from '../src/library/knowledge-library.js'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('uploads only the released HTML and obtains a share only after successful publication', async () => {
  vi.stubEnv('DSH_ONLINE_URL', 'https://example.com/dashboards')
  vi.stubEnv('DSH_ONLINE_ADMIN_TOKEN', 'test-secret')
  const library = { getRelease: vi.fn().mockResolvedValue({ revision: { revision: 'rev-0002' }, manifest: { displayName: 'Sales' }, html: '<h1>Sales</h1>', model: { private: true } }) } as unknown as KnowledgeLibrary
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{"url":"https://example.com/dashboards/s/token"}'))
  vi.stubGlobal('fetch', fetcher)
  await expect(publishOnline(library, 'sales-board')).resolves.toHaveProperty('url')
  expect(library.getRelease).toHaveBeenCalledWith('sales-board')
  expect(fetcher.mock.calls[0][0]).toBe('https://example.com/dashboards/api/releases')
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ assetId: 'sales-board', revision: 'rev-0002', title: 'Sales', html: '<h1>Sales</h1>' })
  expect(fetcher.mock.calls[0][1].redirect).toBe('error')
  expect(fetcher.mock.calls[1][0]).toBe('https://example.com/dashboards/api/shares')
})

it('does not create a share when publishing fails', async () => {
  vi.stubEnv('DSH_ONLINE_URL', 'https://example.com')
  vi.stubEnv('DSH_ONLINE_ADMIN_TOKEN', 'test-secret')
  const library = { getRelease: vi.fn().mockResolvedValue({ revision: { revision: 'rev-0001' }, manifest: { displayName: 'Sales' }, html: 'test' }) } as unknown as KnowledgeLibrary
  const fetcher = vi.fn().mockResolvedValue(new Response('{"error":"conflict"}', { status: 409 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(publishOnline(library, 'sales-board')).rejects.toThrow('conflict')
  expect(fetcher).toHaveBeenCalledTimes(1)
})
