import { lieflatEntry, lieflatPreview, lieflatCover } from './lieflat-templates.js'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import type { DesignTemplateDetail, DesignTemplateSummary } from './design-template-library.js'

const TEMPLATE_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/i
const RENDERER_VERSION = 'template-cover-renderer-v2'
const VIEWPORT = { width: 1440, height: 810 }
const COVER = { width: 640, height: 360 }

export type TemplateStatus = 'queued' | 'building' | 'rendering' | 'ready' | 'failed'

export type TemplateManifest = {
  id: string
  name: string
  description: string
  version: string
  category: 'dashboard'
  theme: 'light' | 'dark'
  tags: string[]
  status: TemplateStatus
  rendererVersion?: string
  buildHash?: string
  coverUrl?: string
  previewUrl: string
  updatedAt: string
  error?: string
}

export type TemplateCard = DesignTemplateSummary & Pick<TemplateManifest, 'description' | 'version' | 'theme' | 'tags' | 'status' | 'coverUrl' | 'previewUrl' | 'updatedAt' | 'error'>

export type TemplateCoverLibraryOptions = { cacheRoot: string; edgeExecutablePath?: string }

type TemplateLayout = 'editorial' | 'dense' | 'rounded' | 'standard'
type ParsedDesign = Pick<TemplateManifest, 'id' | 'name' | 'description' | 'version' | 'theme' | 'tags'> & { primaryColor?: string; layout: TemplateLayout }

const defaultFixture = {
  title: '经营分析概览',
  period: '2026 年 8 月',
  kpis: [{ label: '销售额', value: '¥ 12.8M', change: '+18.4%' }, { label: '毛利率', value: '34.6%', change: '+2.1pp' }, { label: '活跃客户', value: '4,286', change: '+8.2%' }, { label: '目标达成', value: '93.5%', change: '+6.7pp' }],
  series: [32, 48, 43, 64, 59, 77, 86],
}

function quoted(value: string): string { return value.replace(/^['"]|['"]$/g, '').trim() }

/** A deliberately small Front Matter reader: template descriptors are data, never executable YAML. */
export function parseTemplateFrontMatter(content: string, fallback: DesignTemplateSummary): ParsedDesign {
  const frontMatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ''
  const value = (key: string): string | undefined => new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'mi').exec(frontMatter)?.[1] && quoted(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'mi').exec(frontMatter)![1])
  const id = value('id') ?? fallback.id
  if (!TEMPLATE_ID.test(id) || id.toLowerCase() !== fallback.id.toLowerCase()) throw new Error('TEMPLATE_MANIFEST_ID_INVALID')
  const theme = value('theme') === 'dark' ? 'dark' : 'light'
  const tags = [...frontMatter.matchAll(/^\s*-\s*(.+?)\s*$/gm)].map(match => quoted(match[1])).filter(Boolean).slice(0, 8)
  const primaryColor = /(?:^|\n)\s*primary:\s*["']?(#[0-9a-f]{3,8})["']?\s*$/im.exec(content)?.[1]
    ?? /#[0-9a-f]{6}\b/i.exec(content)?.[0]
  const source = `${fallback.id}\n${content}`.toLowerCase()
  const layout: TemplateLayout = /editorial|photography|warm canvas|magazine|storytelling/.test(source)
    ? 'editorial'
    : /trading|market|dense|table|terminal|financial/.test(source)
      ? 'dense'
      : /friendly|playful|soft|rounded|community/.test(source)
        ? 'rounded'
        : 'standard'
  return {
    id: fallback.id,
    name: value('name') ?? fallback.name,
    description: value('description') ?? '基于设计规范生成的可运行看板模板。',
    version: value('version') ?? '1.0.0',
    theme,
    tags,
    primaryColor,
    layout,
  }
}

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)) }

/** This is the executable template implementation for the current vanilla-HTML stack. */
export function renderTemplateDocument(design: ParsedDesign, fixture = defaultFixture): string {
  const dark = design.theme === 'dark'
  const colors = dark
    ? { bg: '#0f172a', panel: '#172033', line: '#2c3a54', ink: '#f8fafc', muted: '#9aa9c2', accent: '#6ea8ff', fill: 'rgba(110,168,255,.16)' }
    : { bg: '#f5f7fb', panel: '#ffffff', line: '#e4e8f0', ink: '#182033', muted: '#758198', accent: '#3155c6', fill: 'rgba(49,85,198,.12)' }
  if (design.primaryColor) colors.accent = design.primaryColor
  const kpis = fixture.kpis.map((item: { label: string; value: string; change: string }) => `<article class="kpi"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><em>${escapeHtml(item.change)}</em></article>`).join('')
  const points = fixture.series.map((value: number, index: number) => `${index * 92 + 34},${246 - value * 1.8}`).join(' ')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(design.name)}</title><style>:root{--bg:${colors.bg};--panel:${colors.panel};--line:${colors.line};--ink:${colors.ink};--muted:${colors.muted};--accent:${colors.accent};--fill:${colors.fill}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 Inter,"Microsoft YaHei",sans-serif}.dashboard{width:1440px;min-height:810px;padding:46px 56px}.top{display:flex;align-items:end;justify-content:space-between;margin-bottom:28px}.eyebrow{margin:0 0 7px;color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.top h1{margin:0;font-size:30px;letter-spacing:-.04em}.top p{margin:8px 0 0;color:var(--muted);font-size:14px}.period{padding:9px 13px;border:1px solid var(--line);border-radius:9px;color:var(--muted);background:var(--panel)}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.kpi,.panel{border:1px solid var(--line);border-radius:15px;background:var(--panel)}.kpi{min-height:126px;padding:18px}.kpi span,.panel-head span{display:block;color:var(--muted);font-size:12px}.kpi strong{display:block;margin:13px 0 7px;font-size:28px;letter-spacing:-.04em}.kpi em{color:#2f9b73;font-size:12px;font-style:normal}.grid{display:grid;grid-template-columns:1.58fr 1fr;gap:16px;margin-top:16px}.panel{min-height:365px;padding:20px}.panel-head{display:flex;align-items:start;justify-content:space-between}.panel-head h2{margin:0 0 4px;font-size:16px}.legend{color:var(--accent);font-size:12px}.chart{width:100%;height:270px;margin-top:22px}.chart line{stroke:var(--line);stroke-width:1}.chart polyline{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.chart path{fill:var(--fill)}.rows{display:grid;gap:17px;margin-top:29px}.row{display:grid;grid-template-columns:95px 1fr 48px;gap:12px;align-items:center}.row span{color:var(--muted);font-size:12px}.bar{height:9px;border-radius:20px;background:var(--fill);overflow:hidden}.bar i{display:block;height:100%;border-radius:inherit;background:var(--accent)}.row b{font-size:12px;text-align:right}.dashboard.dense{padding:30px 38px;font-size:13px}.dashboard.dense .top{margin-bottom:16px}.dashboard.dense .kpis{grid-template-columns:repeat(5,1fr);gap:10px}.dashboard.dense .kpi,.dashboard.dense .panel{border-radius:8px}.dashboard.dense .kpi{min-height:104px;padding:14px}.dashboard.dense .grid{grid-template-columns:1.8fr 1fr;gap:10px;margin-top:10px}.dashboard.dense .panel{min-height:392px;padding:16px}.dashboard.editorial{padding:58px 76px;font-family:Georgia,"Microsoft YaHei",serif}.dashboard.editorial .top{align-items:start;margin-bottom:36px}.dashboard.editorial .kpis{grid-template-columns:repeat(3,1fr);gap:22px}.dashboard.editorial .kpi,.dashboard.editorial .panel{border-radius:2px}.dashboard.editorial .grid{grid-template-columns:1fr 1.2fr;gap:22px}.dashboard.rounded .kpi,.dashboard.rounded .panel,.dashboard.rounded .period{border-radius:24px}.dashboard.rounded .kpis{gap:20px}.dashboard.rounded .grid{gap:20px}</style></head><body><main class="dashboard ${design.layout}" data-template-preview-ready="true"><header class="top"><div><p class="eyebrow">${escapeHtml(design.name)}</p><h1>${escapeHtml(fixture.title)}</h1><p>${escapeHtml(design.description)}</p></div><span class="period">${escapeHtml(fixture.period)}</span></header><section class="kpis">${kpis}</section><section class="grid"><article class="panel"><div class="panel-head"><div><h2>核心趋势</h2><span>近 7 个周期的业务走势</span></div><b class="legend">● 本期数据</b></div><svg class="chart" viewBox="0 0 680 280" preserveAspectRatio="none"><line x1="0" y1="45" x2="680" y2="45"/><line x1="0" y1="115" x2="680" y2="115"/><line x1="0" y1="185" x2="680" y2="185"/><path d="M34,246 L34,${246 - fixture.series[0] * 1.8} ${fixture.series.map((value: number, index: number) => `L${index * 92 + 34},${246 - value * 1.8}`).join(' ')} L586,246 Z"/><polyline points="${points}"/></svg></article><article class="panel"><div class="panel-head"><div><h2>业务构成</h2><span>关键维度实时占比</span></div></div><div class="rows"><div class="row"><span>直营网点</span><div class="bar"><i style="width:74%"></i></div><b>74%</b></div><div class="row"><span>线上渠道</span><div class="bar"><i style="width:58%"></i></div><b>58%</b></div><div class="row"><span>合作伙伴</span><div class="bar"><i style="width:42%"></i></div><b>42%</b></div><div class="row"><span>新兴市场</span><div class="bar"><i style="width:31%"></i></div><b>31%</b></div></div></article></section></main></body></html>`
}

async function fileExists(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }
async function writeAtomic(path: string, value: string | Buffer): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, value); await rename(temp, path) }

function edgePath(configured?: string): string {
  return configured ?? process.env.DSH_TEMPLATE_EDGE_PATH ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
}

export class TemplateCoverLibrary {
  constructor(private readonly options: TemplateCoverLibraryOptions) {}

  async cards(templates: DesignTemplateSummary[], publicBase = '/api/design-templates'): Promise<TemplateCard[]> {
    return Promise.all(templates.map(async template => ({ ...template, ...await this.readManifest(template, publicBase) })))
  }

  async build(detail: DesignTemplateDetail, publicBase = '/api/design-templates'): Promise<{ manifest: TemplateManifest; cacheHit: boolean }> {
    if (detail.provider === 'Lieflat Charts') return { manifest: await this.readManifest(detail, publicBase), cacheHit: true }
    const design = parseTemplateFrontMatter(detail.content, detail)
    const fixture = defaultFixture
    const html = renderTemplateDocument(design, fixture)
    const buildHash = createHash('sha256').update(detail.content).update(html).update(JSON.stringify(fixture)).update(RENDERER_VERSION).digest('hex')
    const existing = await this.readManifest(detail, publicBase)
    if (existing.status === 'ready' && existing.buildHash === buildHash && await fileExists(this.coverPath(detail))) return { manifest: existing, cacheHit: true }
    const base = this.base(detail)
    const queued: TemplateManifest = { ...this.manifestBase(design, publicBase), status: 'building', rendererVersion: RENDERER_VERSION, buildHash, updatedAt: new Date().toISOString() }
    await mkdir(join(base, 'src'), { recursive: true }); await mkdir(join(base, 'fixtures'), { recursive: true }); await mkdir(join(base, 'generated'), { recursive: true })
    await writeAtomic(join(base, 'design.md'), detail.content)
    await writeAtomic(join(base, 'src', 'Template.html'), html)
    await writeAtomic(join(base, 'fixtures', 'preview-data.json'), JSON.stringify(fixture, null, 2))
    await this.writeManifest(detail, queued)
    try {
      const rendering = { ...queued, status: 'rendering' as const, updatedAt: new Date().toISOString() }
      await this.writeManifest(detail, rendering)
      const browser = await chromium.launch({ executablePath: edgePath(this.options.edgeExecutablePath), headless: true })
      try {
        const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
        await page.setContent(html, { waitUntil: 'networkidle' })
        await page.waitForSelector('[data-template-preview-ready="true"]')
        const screenshot = await page.screenshot({ type: 'png' })
        const cover = await sharp(screenshot).resize(COVER.width, COVER.height, { fit: 'cover', position: 'top' }).webp({ quality: 84 }).toBuffer()
        await writeAtomic(this.coverPath(detail), cover)
      } finally { await browser.close() }
      const ready: TemplateManifest = { ...rendering, status: 'ready', coverUrl: `${publicBase}/${encodeURIComponent(detail.id)}/cover.webp`, updatedAt: new Date().toISOString() }
      await this.writeManifest(detail, ready)
      return { manifest: ready, cacheHit: false }
    } catch (error) {
      const failed: TemplateManifest = { ...queued, status: 'failed', error: error instanceof Error ? error.message.slice(0, 240) : 'TEMPLATE_RENDER_FAILED', updatedAt: new Date().toISOString() }
      await this.writeManifest(detail, failed)
      return { manifest: failed, cacheHit: false }
    }
  }

  async preview(template: DesignTemplateSummary): Promise<string | undefined> {
    if (template.provider === 'Lieflat Charts') return lieflatPreview(template.id)
    const path = join(this.base(template), 'src', 'Template.html')
    return await fileExists(path) ? readFile(path, 'utf8') : undefined
  }

  async cover(template: DesignTemplateSummary): Promise<Buffer | undefined> {
    if (template.provider === 'Lieflat Charts') return lieflatCover(template.id)
    const path = this.coverPath(template)
    return await fileExists(path) ? readFile(path) : undefined
  }

  private async readManifest(template: DesignTemplateSummary, publicBase = '/api/design-templates'): Promise<TemplateManifest> {
    if (template.provider === 'Lieflat Charts') {
      const entry = await lieflatEntry(template.id)
      if (!entry) throw new Error('DESIGN_TEMPLATE_NOT_FOUND')
      return { id: entry.id, name: entry.name, description: entry.description, version: template.contentSha.slice(0, 8), category: 'dashboard', theme: 'light', tags: entry.tags, status: 'ready', previewUrl: `${publicBase}/${entry.id}/preview`, coverUrl: `${publicBase}/${entry.id}/cover.webp`, updatedAt: '', buildHash: template.contentSha }
    }
    const fallback: TemplateManifest = { id: template.id, name: template.name, description: '模板尚未构建预览封面。', version: '1.0.0', category: 'dashboard', theme: 'light', tags: [], status: 'queued', previewUrl: `${publicBase}/${encodeURIComponent(template.id)}/preview`, updatedAt: new Date(0).toISOString() }
    const path = join(this.base(template), 'manifest.json')
    if (!await fileExists(path)) return fallback
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as TemplateManifest
      if (value.id !== template.id) return fallback
      // Covers from an older renderer are intentionally re-queued so a visual
      // fix cannot be hidden behind a previously generated identical image.
      if (value.rendererVersion !== RENDERER_VERSION) return { ...fallback, description: value.description || fallback.description, theme: value.theme, tags: value.tags }
      return value
    } catch { return fallback }
  }

  private manifestBase(design: ParsedDesign, publicBase: string): Omit<TemplateManifest, 'status' | 'buildHash' | 'updatedAt'> {
    return { ...design, category: 'dashboard', previewUrl: `${publicBase}/${encodeURIComponent(design.id)}/preview` }
  }
  private async writeManifest(template: DesignTemplateSummary, manifest: TemplateManifest): Promise<void> { await writeAtomic(join(this.base(template), 'manifest.json'), JSON.stringify(manifest, null, 2)) }
  private base(template: DesignTemplateSummary): string { return join(this.options.cacheRoot, 'design-templates', 'templates', template.id) }
  private coverPath(template: DesignTemplateSummary): string { return join(this.base(template), 'generated', 'cover.webp') }
}
