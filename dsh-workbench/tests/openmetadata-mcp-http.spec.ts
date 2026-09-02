import { describe, expect, it, vi } from 'vitest'
import { OpenMetadataSemanticHttpClient } from '../src/data-connectors/openmetadata-mcp-http.js'

describe('OpenMetadata semantic HTTP adapter', () => {
  it('keeps the MCP credential on the server and projects semantic candidates', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params?: { name?: string } }
      if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body, result: {} }))
      if (body.method === 'notifications/initialized') return new Response('')
      if (body.params?.name === 'semantic_search') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body, result: { structuredContent: { query: '月活用户', totalFound: 1, results: [{ fullyQualifiedName: 'svc.db.schema.dau', entityType: 'table', name: 'dau', description: '日活用户', service: { name: 'svc' }, columns: [{ name: 'stat_date' }, { name: 'active_user_num' }] }] } } }))
      throw new Error('Unexpected MCP call')
    })
    const fetchImpl = fetchMock as unknown as typeof fetch
    const client = new OpenMetadataSemanticHttpClient({ url: 'https://metadata.example/mcp', token: 'secret-not-for-browser', fetchImpl })

    await expect(client.search('月活用户')).resolves.toMatchObject({
      results: [{ fqn: 'svc.db.schema.dau', entityType: 'table', columns: ['stat_date', 'active_user_num'] }],
    })
    const requests = fetchMock.mock.calls.map(([, init]) => init as RequestInit)
    expect(requests.some(request => String(request.headers && (request.headers as Record<string, string>).authorization).includes('secret-not-for-browser'))).toBe(true)
    expect(JSON.stringify(requests.map(request => request.body))).not.toContain('secret-not-for-browser')
  })

  it('projects fields from an entity-detail response that omits entityType', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params?: { name?: string } }
      if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body, result: {} }))
      if (body.method === 'notifications/initialized') return new Response('')
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body, result: { structuredContent: { fullyQualifiedName: 'svc.db.schema.monthly_active', name: 'monthly_active', description: '月活用户汇总', columns: [{ name: 'month' }, { name: 'active_user_num' }], tags: [{ name: 'Tier.Tier1' }] } } }))
    })
    const client = new OpenMetadataSemanticHttpClient({ url: 'https://metadata.example/mcp', token: 'test-token', fetchImpl: fetchMock as unknown as typeof fetch })

    await expect(client.details('table', 'svc.db.schema.monthly_active')).resolves.toMatchObject({
      entityType: 'table', columns: ['month', 'active_user_num'], tags: ['Tier.Tier1'],
    })
  })
})
