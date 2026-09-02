import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { TemplateCoverLibrary, parseTemplateFrontMatter, renderTemplateDocument } from '../src/design-library/template-cover-library.js'

const roots: string[] = []
const detail = {
  id: 'dark-contrast', name: '深色高对比', sourcePath: 'templates/dark-contrast/design.md', sourceUrl: 'https://example.test/dark-contrast', contentSha: 'fixture-sha', cachedAt: '2026-08-28T09:00:00.000Z',
  content: `---\nid: dark-contrast\nname: 深色高对比\ndescription: 深色背景、高对比数据展示。\nversion: 1.0.0\ntheme: dark\ntags:\n  - 经营分析\n  - 趋势监控\n---\n# 设计目标\n突出核心经营指标。`,
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('template cover library', () => {
  it('validates Front Matter and renders an executable, ready-marked preview document', () => {
    const parsed = parseTemplateFrontMatter(detail.content, detail)
    expect(parsed).toMatchObject({ id: 'dark-contrast', theme: 'dark', tags: ['经营分析', '趋势监控'] })
    expect(renderTemplateDocument(parsed)).toContain('data-template-preview-ready="true"')
  })

  it('renders a real browser cover at 640 by 360 WebP and reuses a matching build hash', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-template-cover-')); roots.push(root)
    const library = new TemplateCoverLibrary({ cacheRoot: root })
    const first = await library.build(detail)
    expect(first).toMatchObject({ cacheHit: false, manifest: { status: 'ready', rendererVersion: 'template-cover-renderer-v2', coverUrl: '/api/design-templates/dark-contrast/cover.webp' } })
    const cover = await library.cover(detail)
    expect(cover).toBeDefined()
    await expect(sharp(cover!).metadata()).resolves.toMatchObject({ format: 'webp', width: 640, height: 360 })
    await expect(library.preview(detail)).resolves.toContain('data-template-preview-ready="true"')
    await expect(library.build(detail)).resolves.toMatchObject({ cacheHit: true, manifest: { status: 'ready' } })
  }, 30_000)
  })

  it('renders selected design rules into visibly distinct cover documents', () => {
    const editorial = parseTemplateFrontMatter('---\nname: Editorial\ncolors:\n  primary: "#ff5a5f"\n---\nA warm editorial photography-first canvas.', { ...detail, id: 'editorial', name: 'Editorial' })
    const dense = parseTemplateFrontMatter('---\nname: Trading\ncolors:\n  primary: "#fcd535"\n---\nA dense financial market table.', { ...detail, id: 'trading', name: 'Trading' })
    expect(renderTemplateDocument(editorial)).toContain('dashboard editorial')
    expect(renderTemplateDocument(editorial)).toContain('#ff5a5f')
    expect(renderTemplateDocument(dense)).toContain('dashboard dense')
    expect(renderTemplateDocument(dense)).toContain('#fcd535')
  })
