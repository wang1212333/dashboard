import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { FilesystemKnowledgeLibrary } from '../library/filesystem-library.js'
import { analyzeCsv, type DashboardFieldMapping } from '../data-ingestion/csv-profile.js'
import { AgentUploadStore } from '../data-ingestion/agent-upload-store.js'
import { assertCsvMatchesSnapshot, assertLatestPeriodComplete, assertSkuMetricSemantics, snapshotCsvSource } from '../data-ingestion/source-integrity.js'
import { DashboardAgentRunService, type DashboardRunEvent } from '../agent-run/dashboard-agent-run.js'
import { DesignTemplateLibrary, toBrowserTemplate, withDesignTemplate } from '../design-library/design-template-library.js'
import { TemplateCoverLibrary } from '../design-library/template-cover-library.js'
import { renderLocalWorkbenchPage } from './page.js'
import { toDashboardSummary } from './dashboard-repository.js'
import { WorkbenchHistoryStore } from './history-store.js'
import { confirmDashboardPlan, isDashboardSpec, planFromAnalysis } from '../dashboard-agent/workflow.js'
import type { DashboardPlan, DashboardPlanConfirmation } from '../dashboard-agent/contracts.js'
import type { SemanticContext } from '../data-connectors/openmetadata-mcp.js'
import { OpenMetadataMcpError, OpenMetadataSemanticHttpClient } from '../data-connectors/openmetadata-mcp-http.js'
import type { DashboardVisualContract } from '../dashboard-build/universal-contract.js'

const MAX_CSV_BYTES = 20 * 1024 * 1024
// JSON escaping adds bytes beyond the source CSV; enforce the user-facing limit after parsing.
const MAX_BODY_BYTES = MAX_CSV_BYTES + 512 * 1024
const REVISION = /^rev-\d{4}$/
const DATA_AGENT_LOGO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'assets/data-agent-logo-black.png')
const THREE_MODULE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/three/build/three.module.js')
const THREE_CORE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/three/build/three.core.js')

export interface LocalWorkbenchAppOptions { libraryRoot: string; host?: string; port?: number }
export interface RunningLocalWorkbenchApp { server: Server; url: string; close(): Promise<void> }

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

function html(response: ServerResponse, value: string): void {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(value)
}

function text(response: ServerResponse, value: string): void {
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  response.end(value)
}
function javascript(response: ServerResponse, value: string): void {
  response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' })
  response.end(value)
}
function image(response: ServerResponse, value: Buffer): void {
  response.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'no-store' })
  response.end(value)
}
function png(response: ServerResponse, value: Buffer): void {
  response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
  response.end(value)
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!)) }
function sendSse(response: ServerResponse, event: DashboardRunEvent): void { response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`) }

export function renderRevisionPreviewPage(assetId: string, revision: string): string {
  const asset = encodeURIComponent(assetId); const rev = encodeURIComponent(revision)
  const dashboardUrl = `/assets/${asset}/${rev}/dashboard.html`
  const sourceUrl = `/assets/${asset}/${rev}/source.html`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>看板预览 · ${assetId} ${revision}</title><style>:root{--ink:#172033;--line:#dbe2ef;--brand:#3155c6;--soft:#f4f6fa}*{box-sizing:border-box}body{margin:0;background:var(--soft);color:var(--ink);font:14px/1.5 "Microsoft YaHei",Arial,sans-serif}header{height:58px;display:flex;align-items:center;gap:12px;padding:0 20px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:2}.title{font-weight:700;margin-right:auto}.tab{border:1px solid var(--line);background:#fff;border-radius:7px;padding:8px 12px;cursor:pointer;font:inherit}.tab.active{background:var(--brand);border-color:var(--brand);color:#fff}main{height:calc(100vh - 58px)}iframe,pre{width:100%;height:100%;border:0;margin:0}.source{display:none;padding:20px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#101827;color:#dbeafe;font:12px/1.55 Consolas,"Courier New",monospace}</style></head><body><header><span class="title">${assetId} · ${revision}</span><button id="visual" class="tab active">网页效果</button><button id="source" class="tab">HTML 源码</button><a href="${dashboardUrl}" target="_blank" rel="noopener">在新标签打开</a></header><main><iframe id="frame" title="看板网页预览" src="${dashboardUrl}"></iframe><pre id="code" class="source"></pre></main><script>const visual=document.getElementById('visual'),source=document.getElementById('source'),frame=document.getElementById('frame'),code=document.getElementById('code');let loaded=false;visual.onclick=()=>{visual.classList.add('active');source.classList.remove('active');frame.style.display='block';code.style.display='none'};source.onclick=async()=>{source.classList.add('active');visual.classList.remove('active');frame.style.display='none';code.style.display='block';if(!loaded){code.textContent='正在加载源码…';try{const r=await fetch('${sourceUrl}');if(!r.ok)throw new Error('加载失败');code.textContent=await r.text();loaded=true}catch(e){code.textContent=e instanceof Error?e.message:'加载失败'}}};</script></body></html>`
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > MAX_BODY_BYTES) throw new Error('UPLOAD_TOO_LARGE: maximum CSV size is 20 MB')
    chunks.push(buffer)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  if (!value || Array.isArray(value)) throw new Error('REQUEST_BODY_INVALID')
  if (typeof value.csv === 'string' && Buffer.byteLength(value.csv, 'utf8') > MAX_CSV_BYTES) throw new Error('UPLOAD_TOO_LARGE: maximum CSV size is 20 MB')
  return value
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name.toUpperCase()}_REQUIRED`)
  return value.trim()
}

function mappingValue(value: unknown): DashboardFieldMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, column]) => typeof column === 'string' && column.trim()).map(([role, column]) => [role, (column as string).trim()]))
}

function templateValue(value: unknown): 'content-ops-v1' | 'finance-pnl-v1' | 'supply-sales-v1' | 'sku-operations-v1' {
  if (value === 'content-ops-v1' || value === 'finance-pnl-v1' || value === 'supply-sales-v1' || value === 'sku-operations-v1') return value
  throw new Error('TEMPLATE_INVALID')
}

const TEMPLATE_SELECTION_COOKIE = 'dsh-workbench-design-template'
function cookieValue(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1)
}
function selectionCookie(templateId: string): string {
  return `${TEMPLATE_SELECTION_COOKIE}=${encodeURIComponent(templateId)}; Path=/; Max-Age=28800; SameSite=Strict; HttpOnly`
}
function clearSelectionCookie(): string { return `${TEMPLATE_SELECTION_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly` }

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
  if (error instanceof OpenMetadataMcpError) return error.statusCode
  if (/REQUIRED|INVALID|TOO_LARGE|CSV_|DATA_|ASSET_ID|CONFIRMATION|PUBLISH_|RELEASE_|PREVIEW_|MAPPING_|DASHBOARD_PLAN|HISTORY_/.test(message)) return 400
  if (/NOT_FOUND/.test(message)) return 404
  return 500
}

export function createLocalWorkbenchServer(options: LocalWorkbenchAppOptions): Server {
  const library = new FilesystemKnowledgeLibrary(options.libraryRoot)
  const uploads = new AgentUploadStore(options.libraryRoot)
  const history = new WorkbenchHistoryStore(resolve(options.libraryRoot, 'history', 'build-history.json'))
  const designTemplates = new DesignTemplateLibrary({ cacheRoot: options.libraryRoot })
  const templateCovers = new TemplateCoverLibrary({ cacheRoot: options.libraryRoot })
  const omd = new OpenMetadataSemanticHttpClient()
  const plans = new Map<string, { plan: DashboardPlan; csv: string }>()
  const planCsv = new Map<string, string>()
  const runs = new DashboardAgentRunService({
    async createPlan(input, signal) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const plan = planFromAnalysis(analyzeCsv(input.csv), { planId: randomUUID(), fileName: input.fileName, businessGoal: input.intent, source: snapshotCsvSource(input.csv) })
      planCsv.set(plan.planId, input.csv)
      return plan
    }}, plan => {
      const csv = planCsv.get(plan.planId)
      if (csv) plans.set(plan.planId, { plan, csv })
    })
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    try {
      if (request.method === 'GET' && url.pathname === '/') return html(response, renderLocalWorkbenchPage())
      if (request.method === 'GET' && url.pathname === '/assets/data-agent-logo-black.png') return readFile(DATA_AGENT_LOGO_PATH).then(value => png(response, value))
      if (request.method === 'GET' && url.pathname === '/assets/three.module.js') return readFile(THREE_MODULE_PATH, 'utf8').then(value => javascript(response, value))
      if (request.method === 'GET' && url.pathname === '/assets/three.core.js') return readFile(THREE_CORE_PATH, 'utf8').then(value => javascript(response, value))
      if (request.method === 'GET' && url.pathname === '/api/history') return json(response, 200, { history: await history.read() })
      if (request.method === 'PUT' && url.pathname === '/api/history') {
        const body = await readJson(request)
        return json(response, 200, { history: await history.write(body.history) })
      }
      if (request.method === 'GET' && url.pathname === '/api/dashboards') {
        const includeDrafts = url.searchParams.get('includeDrafts') === 'true'
        const dashboards = await Promise.all((await library.listAssets()).filter(asset => Boolean(includeDrafts ? asset.latestRevision : asset.releasedRevision)).map(async asset => {
          const revision = asset.releasedRevision ?? asset.latestRevision!
          const stored = await library.readRevision(asset.assetId, revision)
          return toDashboardSummary({ ...asset, displayName: stored.manifest.displayName }, `/assets/${encodeURIComponent(asset.assetId)}/${revision}/dashboard.html`, stored.model)
        }))
        return json(response, 200, { dashboards })
      }
      const dashboardDelete = /^\/api\/dashboards\/([a-z][a-z0-9-]{2,62})$/.exec(url.pathname)
      if (request.method === 'DELETE' && dashboardDelete) {
        const body = await readJson(request)
        if (body.confirmed !== true) throw new Error('DELETE_CONFIRMATION_REQUIRED')
        await library.deleteAsset(dashboardDelete[1])
        return json(response, 200, { deleted: true, assetId: dashboardDelete[1] })
      }
      const draftAction = /^\/api\/dashboard-drafts\/([a-z][a-z0-9-]{2,62})\/(rev-\d{4})\/(preview|release)$/.exec(url.pathname)
      if (request.method === 'POST' && draftAction) {
        const [, assetId, revision, action] = draftAction
        if (action === 'preview') {
          const stored = await library.preview(assetId, revision)
          return json(response, 200, { revision: stored.revision, previewUrl: `/assets/${encodeURIComponent(assetId)}/${revision}/dashboard.html` })
        }
        const body = await readJson(request)
        if (body.confirmed !== true) throw new Error('PUBLISH_CONFIRMATION_REQUIRED')
        const release = await library.release(assetId, revision, { approvalId: `user-confirmed:${randomUUID()}` })
        return json(response, 200, { release, dashboardUrl: `/assets/${encodeURIComponent(assetId)}/${release.revision}/dashboard.html` })
      }
      if (request.method === 'POST' && url.pathname === '/api/analyze') {
        const body = await readJson(request)
        return json(response, 200, analyzeCsv(requiredString(body.csv, 'csv')))
      }
      if (request.method === 'POST' && url.pathname === '/api/omd/search') {
        const body = await readJson(request)
        return json(response, 200, await omd.search(requiredString(body.query, 'omd_query')))
      }
      if (request.method === 'POST' && url.pathname === '/api/omd/details') {
        const body = await readJson(request)
        return json(response, 200, { asset: await omd.details(requiredString(body.entityType, 'entityType'), requiredString(body.fqn, 'fqn')) })
      }
      if (request.method === 'POST' && url.pathname === '/api/dashboard-plans') {
        const body = await readJson(request)
        const csv = requiredString(body.csv, 'csv')
        const analysis = analyzeCsv(csv)
        const plan = planFromAnalysis(analysis, {
          planId: randomUUID(), fileName: typeof body.fileName === 'string' ? body.fileName : undefined, source: snapshotCsvSource(csv),
          businessGoal: requiredString(body.businessGoal ?? body.intent, 'businessGoal'),
          title: typeof body.title === 'string' ? body.title : undefined,
          audience: Array.isArray(body.audience) ? body.audience.filter((value): value is string => typeof value === 'string') : undefined,
          decisions: Array.isArray(body.decisions) ? body.decisions.filter((value): value is string => typeof value === 'string') : undefined,
          semanticContext: body.semanticContext as SemanticContext | undefined,
          visualContract: body.visualContract as DashboardVisualContract | undefined,
          storylinePlan: body.storylinePlan as DashboardPlan['storylinePlan'] | undefined,
          templateId: body.templateId === 'content-ops-v1' || body.templateId === 'finance-pnl-v1' || body.templateId === 'supply-sales-v1' || body.templateId === 'sku-operations-v1' ? body.templateId : undefined,
          mapping: mappingValue(body.mapping),
        })
        plans.set(plan.planId, { plan, csv })
        return json(response, 201, { plan, analysis: { rowCount: analysis.rowCount, fields: analysis.fields, recommendations: analysis.recommendations } })
      }
      const confirmation = /^\/api\/dashboard-plans\/([a-f0-9-]{36})\/confirm$/.exec(url.pathname)
      if (request.method === 'POST' && confirmation) {
        const body = await readJson(request)
        const saved = plans.get(confirmation[1])
        if (!saved) throw new Error('DASHBOARD_PLAN_NOT_FOUND')
        const spec = confirmDashboardPlan(saved.plan, body.confirmation as DashboardPlanConfirmation)
        assertCsvMatchesSnapshot(saved.csv, spec.source)
        assertLatestPeriodComplete(saved.csv, spec.mapping.period)
        if (spec.templateId === 'sku-operations-v1') assertSkuMetricSemantics(saved.csv, spec.mapping)
        const stored = await library.buildDraft(saved.csv, {
          assetId: requiredString(body.assetId, 'assetId'), templateId: spec.templateId, mapping: spec.mapping, spec,
          displayName: spec.title, sourceLabel: typeof body.sourceLabel === 'string' ? body.sourceLabel.trim() : undefined,
        })
        plans.delete(confirmation[1])
        return json(response, 201, { spec, asset: stored.asset, revision: stored.revision, quality: stored.quality, dashboardUrl: `/assets/${encodeURIComponent(stored.asset.assetId)}/${stored.revision.revision}/dashboard.html` })
      }
      if (request.method === 'POST' && url.pathname === '/api/uploads') {
        const body = await readJson(request)
        return json(response, 201, await uploads.saveCsv(typeof body.fileName === 'string' ? body.fileName : 'dataset.csv', requiredString(body.csv, 'csv')))
      }
      if (request.method === 'GET' && url.pathname === '/api/design-templates') {
        const result = await designTemplates.listResult()
        return json(response, 200, { ...result, templates: await templateCovers.cards(result.templates) })
      }
      if (request.method === 'POST' && url.pathname === '/api/design-templates/sync') {
        const result = await designTemplates.syncResult()
        return json(response, 200, { ...result, templates: await templateCovers.cards(result.templates) })
      }
      if (request.method === 'POST' && url.pathname === '/api/design-templates/selection') {
        const body = await readJson(request)
        const detail = await designTemplates.get(requiredString(body.templateId, 'templateId'))
        return json(response, 200, { selected: true, template: toBrowserTemplate(detail) }, { 'set-cookie': selectionCookie(detail.id) })
      }
      if (request.method === 'DELETE' && url.pathname === '/api/design-templates/selection') {
        return json(response, 200, { selected: false }, { 'set-cookie': clearSelectionCookie() })
      }
      const designTemplate = /^\/api\/design-templates\/([a-z0-9][a-z0-9.-]{1,80})$/i.exec(url.pathname)
      const templateBuild = /^\/api\/design-templates\/([a-z0-9][a-z0-9.-]{1,80})\/(?:build|retry)$/i.exec(url.pathname)
      if (request.method === 'POST' && templateBuild) {
        const detail = await designTemplates.get(templateBuild[1])
        return json(response, 200, await templateCovers.build(detail))
      }
      const templatePreview = /^\/api\/design-templates\/([a-z0-9][a-z0-9.-]{1,80})\/preview$/i.exec(url.pathname)
      if (request.method === 'GET' && templatePreview) {
        const detail = await designTemplates.get(templatePreview[1])
        const preview = await templateCovers.preview(detail)
        return preview ? html(response, preview) : json(response, 404, { error: 'TEMPLATE_PREVIEW_NOT_BUILT' })
      }
      const templateCover = /^\/api\/design-templates\/([a-z0-9][a-z0-9.-]{1,80})\/cover\.webp$/i.exec(url.pathname)
      if (request.method === 'GET' && templateCover) {
        const detail = await designTemplates.get(templateCover[1])
        const cover = await templateCovers.cover(detail)
        return cover ? image(response, cover) : json(response, 404, { error: 'TEMPLATE_COVER_NOT_BUILT' })
      }
      if (request.method === 'GET' && designTemplate) {
        return json(response, 200, { template: toBrowserTemplate(await designTemplates.get(designTemplate[1])) })
      }
      if (request.method === 'POST' && url.pathname === '/api/runs') {
        const body = await readJson(request)
        const upload = await uploads.readCsv(requiredString(body.uploadId, 'uploadId'))
        const templateId = typeof body.designTemplateId === 'string' ? body.designTemplateId : cookieValue(request, TEMPLATE_SELECTION_COOKIE)
        const intent = templateId ? withDesignTemplate(requiredString(body.intent, 'intent'), await designTemplates.get(templateId)) : requiredString(body.intent, 'intent')
        const run = runs.start({ csv: upload.csv, fileName: upload.fileName, intent })
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' })
        for await (const event of run.events()) sendSse(response, event)
        return response.end()
      }
      const cancel = /^\/api\/runs\/([a-f0-9-]{36})\/cancel$/.exec(url.pathname)
      if (request.method === 'POST' && cancel) return json(response, 200, { cancelled: runs.cancel(cancel[1]) })
      const assetMatch = /^\/assets\/([a-z][a-z0-9-]{2,62})\/(rev-\d{4})\/(dashboard|source)\.html$/.exec(url.pathname)
      if (request.method === 'GET' && assetMatch && REVISION.test(assetMatch[2])) {
        const stored = await library.readRevision(assetMatch[1], assetMatch[2])
        return assetMatch[3] === 'source' ? text(response, stored.html) : html(response, stored.html)
      }
      return json(response, 404, { error: 'ROUTE_NOT_FOUND' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      return json(response, errorStatus(error), { error: message })
    }
  })
}

export async function startLocalWorkbenchApp(options: LocalWorkbenchAppOptions): Promise<RunningLocalWorkbenchApp> {
  const server = createLocalWorkbenchServer(options)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 4317, options.host ?? '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('LOCAL_SERVER_ADDRESS_UNAVAILABLE')
  return { server, url: `http://${options.host ?? '127.0.0.1'}:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
}
