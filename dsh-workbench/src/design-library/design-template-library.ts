import { lieflatDetail, lieflatSummaries } from './lieflat-templates.js'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const REPOSITORY = 'voltagent/awesome-design-md'
const BRANCH = 'main'
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`
const RAW_ROOT = `https://raw.githubusercontent.com/${REPOSITORY}/${BRANCH}`
const HTML_TREE_URL = `https://github.com/${REPOSITORY}/tree/${BRANCH}/design-md`
const PATH = /^design-md\/([a-z0-9][a-z0-9.-]*)\/DESIGN\.md$/i
const TEMPLATE_ID = /^[a-z0-9][a-z0-9.-]{1,80}$/i
const MAX_TEMPLATE_BYTES = 128 * 1024

export type DesignTemplateSummary = {
  id: string
  name: string
  sourcePath: string
  sourceUrl: string
  contentSha: string
  provider?: string
  kind?: 'report' | 'chart'
  license?: string
}

export type DesignTemplateDetail = DesignTemplateSummary & {
  description?: string
  primaryColor?: string
  cachedAt: string
  content: string
}

export type BrowserDesignTemplate = Omit<DesignTemplateDetail, 'content'> & {
  /** A compact, safe-to-send brief for the embedded DSH browser client. */
  styleGuide: string
}

type CachedCatalog = { repository: string; branch: string; syncedAt: string; templates: DesignTemplateSummary[] }
type GitTree = { tree?: Array<{ path?: string; type?: string; sha?: string }> }

export type DesignTemplateCatalogResult = {
  templates: DesignTemplateSummary[]
  syncedAt: string
  cacheStatus: 'fresh' | 'cached' | 'stale'
  warning?: string
}

export type DesignTemplateLibraryOptions = {
  cacheRoot: string
  fetch?: typeof fetch
}

function displayName(id: string): string {
  return id
    .replace(/\.app$/i, '')
    .replace(/[-.]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase())
}

function parseMetadata(content: string): Pick<DesignTemplateDetail, 'description' | 'primaryColor'> {
  const frontMatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? ''
  const description = /^description:\s*["']?(.+?)["']?\s*$/m.exec(frontMatter)?.[1]?.trim()
  const colorSection = /^colors:\s*\r?\n([\s\S]*?)(?=^[^\s]|$)/m.exec(frontMatter)?.[1] ?? ''
  const primaryColor = /^\s*primary:\s*["']?(#[0-9a-f]{3,8})["']?\s*$/im.exec(colorSection)?.[1]
  return { description, primaryColor }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch { return false }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, path)
}

/**
 * A small, fixed-source catalog for DESIGN.md resources. The browser only sees
 * descriptions and colors; full source remains in this server-side cache until
 * it is injected into a dashboard-generation request.
 */
export class DesignTemplateLibrary {
  private readonly fetcher: typeof fetch

  constructor(private readonly options: DesignTemplateLibraryOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch
  }

  async list(forceSync = false): Promise<DesignTemplateSummary[]> {
    const catalog = forceSync ? undefined : await this.readCatalog()
    return this.withLocalTemplates((catalog ?? await this.sync()).templates)
  }

  /**
   * Serves a previous directory immediately when possible. A transient GitHub
   * failure must not turn a useful template picker into a blank error screen.
   */
  async listResult(): Promise<DesignTemplateCatalogResult> {
    const catalog = await this.readCatalog()
    if (catalog) return { templates: await this.withLocalTemplates(catalog.templates), syncedAt: catalog.syncedAt, cacheStatus: 'cached' }
    return this.syncResult()
  }

  async syncResult(): Promise<DesignTemplateCatalogResult> {
    const cached = await this.readCatalog()
    try {
      const fresh = await this.sync()
      return { templates: await this.withLocalTemplates(fresh.templates), syncedAt: fresh.syncedAt, cacheStatus: 'fresh' }
    } catch (error) {
      if (!cached) return { templates: await this.withLocalTemplates([]), syncedAt: '', cacheStatus: 'stale', warning: '在线风格目录暂时不可用，内置 Lieflat 模板仍可使用。' }
      return {
        templates: await this.withLocalTemplates(cached.templates),
        syncedAt: cached.syncedAt,
        cacheStatus: 'stale',
        warning: '模板目录暂时无法更新，已继续使用本地缓存。',
      }
    }
  }

  async sync(): Promise<CachedCatalog> {
    const response = await this.fetcher(`${API_ROOT}/git/trees/${BRANCH}?recursive=1`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-workbench' } })
    const templates = response.ok ? this.templatesFromTree(await response.json() as GitTree) : await this.templatesFromHtmlDirectory()
    if (!templates.length) throw new Error(`DESIGN_TEMPLATE_SYNC_FAILED:${response.status}`)
    const catalog: CachedCatalog = { repository: REPOSITORY, branch: BRANCH, syncedAt: new Date().toISOString(), templates }
    await writeJsonAtomic(this.catalogPath(), catalog)
    return catalog
  }

  private templatesFromTree(payload: GitTree): DesignTemplateSummary[] {
    return (payload.tree ?? [])
      .flatMap(entry => {
        const match = typeof entry.path === 'string' ? PATH.exec(entry.path) : undefined
        return match && entry.type === 'blob' && typeof entry.sha === 'string'
          ? [{ id: match[1].toLowerCase(), name: displayName(match[1]), sourcePath: entry.path!, sourceUrl: `${RAW_ROOT}/${entry.path}`, contentSha: entry.sha }]
          : []
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  }

  /** GitHub's unauthenticated REST quota is small in shared deployments. The public directory page is a safe fixed-source fallback. */
  private async templatesFromHtmlDirectory(): Promise<DesignTemplateSummary[]> {
    const response = await this.fetcher(HTML_TREE_URL, { headers: { accept: 'text/html', 'user-agent': 'dsh-workbench' } })
    if (!response.ok) return []
    const html = await response.text()
    const ids = [...html.matchAll(/\/voltagent\/awesome-design-md\/tree\/main\/design-md\/([a-z0-9][a-z0-9.-]*)/gi)]
      .map(match => match[1].toLowerCase())
      .filter((id, index, all) => all.indexOf(id) === index)
    const cacheVersion = `unversioned-${Date.now()}`
    return ids.map(id => ({
      id,
      name: displayName(id),
      sourcePath: `design-md/${id}/DESIGN.md`,
      sourceUrl: `${RAW_ROOT}/design-md/${id}/DESIGN.md`,
      contentSha: cacheVersion,
    })).sort((left, right) => left.name.localeCompare(right.name, 'en'))
  }

  async get(templateId: string): Promise<DesignTemplateDetail> {
    if (!TEMPLATE_ID.test(templateId)) throw new Error('DESIGN_TEMPLATE_ID_INVALID')
    if (templateId.toLowerCase().startsWith('lieflat-')) return lieflatDetail(templateId.toLowerCase())
    const template = (await this.list()).find(item => item.id === templateId.toLowerCase())
    if (!template) throw new Error('DESIGN_TEMPLATE_NOT_FOUND')
    if (template.sourcePath.startsWith('local:')) {
      const content = await readFile(this.localTemplatePath(template.id), 'utf8')
      return { ...template, ...parseMetadata(content), cachedAt: new Date().toISOString(), content }
    }
    const cached = await this.readContent(template)
    const content = cached ?? await this.fetchContent(template)
    return { ...template, ...parseMetadata(content), cachedAt: new Date().toISOString(), content }
  }

  private async fetchContent(template: DesignTemplateSummary): Promise<string> {
    const response = await this.fetcher(template.sourceUrl, { headers: { accept: 'text/plain', 'user-agent': 'dsh-workbench' } })
    if (!response.ok) throw new Error(`DESIGN_TEMPLATE_FETCH_FAILED:${response.status}`)
    const content = await response.text()
    if (!content.startsWith('---') || Buffer.byteLength(content, 'utf8') > MAX_TEMPLATE_BYTES) throw new Error('DESIGN_TEMPLATE_CONTENT_INVALID')
    await mkdir(dirname(this.contentPath(template)), { recursive: true })
    await writeFile(this.contentPath(template), content, 'utf8')
    return content
  }

  private async readCatalog(): Promise<CachedCatalog | undefined> {
    if (!await exists(this.catalogPath())) return undefined
    try {
      const catalog = JSON.parse(await readFile(this.catalogPath(), 'utf8')) as CachedCatalog
      return catalog.repository === REPOSITORY && catalog.branch === BRANCH && Array.isArray(catalog.templates) ? catalog : undefined
    } catch { return undefined }
  }

  private async readContent(template: DesignTemplateSummary): Promise<string | undefined> {
    const path = this.contentPath(template)
    return await exists(path) ? readFile(path, 'utf8') : undefined
  }

  /** Curated workbench templates take precedence over the public style catalog. */
  private async withLocalTemplates(templates: DesignTemplateSummary[]): Promise<DesignTemplateSummary[]> {
    templates = [...await lieflatSummaries(), ...templates.filter(item => !item.id.startsWith('lieflat-'))]
    const id = 'sku-operations'
    if (!await exists(this.localTemplatePath(id))) return templates
    const content = await readFile(this.localTemplatePath(id), 'utf8')
    const local: DesignTemplateSummary = {
      id, name: 'SKU Operations Workbench', sourcePath: `local:${this.localTemplatePath(id)}`,
      sourceUrl: 'local://dsh-workbench/sku-operations/design.md', contentSha: `local-${Buffer.byteLength(content, 'utf8')}`,
    }
    return [local, ...templates.filter(template => template.id !== id)].sort((left, right) => left.name.localeCompare(right.name, 'en'))
  }

  private catalogPath(): string { return join(this.options.cacheRoot, 'design-templates', 'catalog.json') }
  private contentPath(template: DesignTemplateSummary): string { return join(this.options.cacheRoot, 'design-templates', 'content', `${template.id}-${template.contentSha}.md`) }
  private localTemplatePath(id: string): string { return join(this.options.cacheRoot, 'design-templates', 'templates', id, 'design.md') }
}

export function toBrowserTemplate(template: DesignTemplateDetail): BrowserDesignTemplate {
  const { content, ...safe } = template
  return { ...safe, styleGuide: template.provider === 'Lieflat Charts' ? content.split('<selected-template-source>')[0].trim() : styleGuide(content) }
}

/**
 * The iframe cannot read the server-side DESIGN.md cache. Keep the full source
 * server-side, but pass the selected template's actionable design rules to the
 * embedded agent so its dashboard is not generated as an unstyled default.
 */
function styleGuide(content: string): string {
  const colors = [...content.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(match => match[0]).filter((value, index, all) => all.indexOf(value) === index).slice(0, 8)
  const rules = content
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:#{1,6}|[-*+]\s+|\d+\.\s+)/, '').replace(/[`*_]/g, '').trim())
    .filter(line => line.length >= 18 && line.length <= 260)
    .filter((line, index, all) => all.indexOf(line) === index)
    .slice(0, 18)
  return [colors.length ? `建议色板：${colors.join('、')}` : '', ...rules].filter(Boolean).join('\n').slice(0, 2_800)
}

export function withDesignTemplate(intent: string, template: DesignTemplateDetail): string {
  if (template.provider === 'Lieflat Charts') return `${intent.trim()}\n\n用户所选模板：${template.name}\n来源：${template.sourceUrl}\n内容 SHA：${template.contentSha}\n${template.content}`
  return `${intent.trim()}\n\n视觉风格参考（仅用于本次看板的界面设计）：\n- 名称：${template.name}\n- 来源：${template.sourceUrl}\n- 内容 SHA：${template.contentSha}\n- 请遵循其中的色彩、排版、组件和响应式规则；不使用品牌商标、图片或受版权限制的素材。\n\n<design-md>\n${template.content}\n</design-md>`
}
