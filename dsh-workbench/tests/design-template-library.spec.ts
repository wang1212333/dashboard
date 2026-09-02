import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesignTemplateLibrary, toBrowserTemplate, withDesignTemplate } from '../src/design-library/design-template-library.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-design-template-'))
  roots.push(value)
  return value
}

describe('design template library', () => {
  it('syncs only the fixed DESIGN.md paths and downloads a selected resource lazily', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url.includes('/git/trees/main')) return new Response(JSON.stringify({ tree: [
        { path: 'design-md/linear.app/DESIGN.md', type: 'blob', sha: 'linear-sha' },
        { path: 'design-md/linear.app/README.md', type: 'blob', sha: 'readme-sha' },
        { path: 'outside/DESIGN.md', type: 'blob', sha: 'outside-sha' },
      ] }), { status: 200 })
      if (url.endsWith('/design-md/linear.app/DESIGN.md')) return new Response('---\nname: Linear-design-analysis\ndescription: "Dark precision"\ncolors:\n  primary: "#5e6ad2"\n---\n\n# Linear', { status: 200 })
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
    const library = new DesignTemplateLibrary({ cacheRoot: await root(), fetch: fetcher })

    await expect(library.list()).resolves.toEqual([expect.objectContaining({ id: 'linear.app', name: 'Linear', contentSha: 'linear-sha' })])
    expect(fetcher).toHaveBeenCalledTimes(1)

    const detail = await library.get('linear.app')
    expect(detail).toMatchObject({ id: 'linear.app', description: 'Dark precision', primaryColor: '#5e6ad2' })
    expect(detail.content).toContain('# Linear')
    await library.get('linear.app')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('adds a selected template as an attributed, bounded visual reference', () => {
    const prompt = withDesignTemplate('生成销售看板', {
      id: 'linear.app', name: 'Linear', sourcePath: 'design-md/linear.app/DESIGN.md', sourceUrl: 'https://raw.githubusercontent.com/voltagent/awesome-design-md/main/design-md/linear.app/DESIGN.md', contentSha: 'linear-sha', cachedAt: '2026-08-28T00:00:00.000Z', content: '---\ncolors:\n  primary: "#5e6ad2"\n---',
    })
    expect(prompt).toContain('视觉风格参考')
    expect(prompt).toContain('内容 SHA：linear-sha')
    expect(prompt).toContain('<design-md>')
    expect(prompt).toContain('不使用品牌商标、图片或受版权限制的素材')
  })

  it('provides a compact style guide to the embedded workbench without exposing the full DESIGN.md', () => {
    const browserTemplate = toBrowserTemplate({
      id: 'binance', name: 'Binance', sourcePath: 'design-md/binance/DESIGN.md', sourceUrl: 'https://example.test/binance', contentSha: 'binance-sha', cachedAt: '2026-08-28T00:00:00.000Z', primaryColor: '#fcd535', content: '---\ndescription: "Dense trading"\n---\n# Colors\n- Use #fcd535 for primary actions.\n# Grid\n- Keep markets tables compact and information dense.',
    })
    expect(browserTemplate).not.toHaveProperty('content')
    expect(browserTemplate.styleGuide).toContain('#fcd535')
    expect(browserTemplate.styleGuide).toContain('markets tables')
  })

  it('falls back to the public directory when the shared GitHub REST quota is exhausted', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url.includes('/git/trees/main')) return new Response('rate limited', { status: 403 })
      if (url.endsWith('/tree/main/design-md')) return new Response('<a href="/VoltAgent/awesome-design-md/tree/main/design-md/linear.app">Linear</a>', { status: 200 })
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
    const library = new DesignTemplateLibrary({ cacheRoot: await root(), fetch: fetcher })
    await expect(library.list()).resolves.toEqual([expect.objectContaining({ id: 'linear.app', contentSha: expect.stringMatching(/^unversioned-/) })])
  })

  it('keeps the cached directory available when a manual refresh fails', async () => {
    let available = true
    const fetcher = vi.fn(async () => available
      ? new Response(JSON.stringify({ tree: [{ path: 'design-md/linear.app/DESIGN.md', type: 'blob', sha: 'linear-sha' }] }), { status: 200 })
      : new Response('unavailable', { status: 503 })) as unknown as typeof fetch
    const library = new DesignTemplateLibrary({ cacheRoot: await root(), fetch: fetcher })
    await expect(library.listResult()).resolves.toMatchObject({ cacheStatus: 'fresh', templates: [expect.objectContaining({ id: 'linear.app' })] })
    available = false
    await expect(library.syncResult()).resolves.toMatchObject({ cacheStatus: 'stale', warning: expect.stringContaining('本地缓存'), templates: [expect.objectContaining({ id: 'linear.app' })] })
  })
})
