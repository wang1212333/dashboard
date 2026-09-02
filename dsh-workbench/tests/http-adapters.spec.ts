import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpMetadataRepository, HttpObjectStore } from '../src/library/http-adapters.js'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

describe('HTTP library adapters', () => {
  it('uses immutable object semantics and never places tokens in object keys', async () => {
    const calls: Array<{ url: URL; init?: RequestInit }> = []
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: new URL(input.toString()), init })
      return init?.method === 'PUT' ? new Response(null, { status: 204 }) : new Response('<html>ok</html>', { status: 200 })
    }) as typeof fetch
    const objects = new HttpObjectStore({ endpoint: 'https://objects.example.internal', bearerToken: 'secret-token' })
    await objects.putImmutable('workspaces/team-a/assets/a/revisions/r/dashboard.html', '<html>ok</html>', 'text/html')
    await expect(objects.getText('workspaces/team-a/assets/a/revisions/r/dashboard.html')).resolves.toBe('<html>ok</html>')
    expect(calls[0].url.pathname).toContain('workspaces%2Fteam-a%2Fassets%2Fa%2Frevisions%2Fr%2Fdashboard.html')
    expect(new Headers(calls[0].init?.headers).get('if-none-match')).toBe('*')
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer secret-token')
  })

  it('maps a missing metadata resource to undefined without masking other errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as typeof fetch
    const metadata = new HttpMetadataRepository({ endpoint: 'https://metadata.example.internal' })
    await expect(metadata.getAsset('team-a', 'unknown')).resolves.toBeUndefined()
  })
})
