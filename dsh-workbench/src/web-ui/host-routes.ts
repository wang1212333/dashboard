import { ConversationShareStore, renderConversationShare } from '../local-app/conversation-share.js'
import { publishOnline } from '../local-app/online-publish.js'
import { dashboardShareState, createDashboardShare, revokeDashboardShare, dashboardFeishu } from '../local-app/dashboard-sharing.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { DashboardFieldMapping } from '../data-ingestion/csv-profile.js'
import type { KnowledgeLibrary } from '../library/knowledge-library.js'
import { analyzeCsv } from '../data-ingestion/csv-profile.js'
import type { EnrichedCsvAnalysis } from '../ai/dsh-model-analyzer.js'
import { AgentUploadStore } from '../data-ingestion/agent-upload-store.js'
import { NativeWorkbenchSessions } from '../native-workbench-sessions.js'
import { assertCsvMatchesSnapshot, assertLatestPeriodComplete, assertSkuMetricSemantics, snapshotCsvSource } from '../data-ingestion/source-integrity.js'
import { DashboardAgentRunService, type DashboardRunEvent } from '../agent-run/dashboard-agent-run.js'
import { NativeDashboardRunService, type NativeDashboardRunEvent } from '../agent-run/native-dashboard-run.js'
import { HeadlessDashboardAgentService, type DashboardAgentStreamEvent, type HeadlessDatasetContext } from '../headless-dashboard-agent.js'
import { DesignTemplateLibrary, toBrowserTemplate, withDesignTemplate } from '../design-library/design-template-library.js'
import { TemplateCoverLibrary } from '../design-library/template-cover-library.js'
import { renderLocalWorkbenchPage } from '../local-app/page.js'
import { toDashboardSummary } from '../local-app/dashboard-repository.js'
import { WorkbenchHistoryStore } from '../local-app/history-store.js'
import { confirmDashboardPlan, planFromAnalysis } from '../dashboard-agent/workflow.js'
import type { DashboardPlan, DashboardPlanConfirmation } from '../dashboard-agent/contracts.js'
import type { SemanticContext } from '../data-connectors/openmetadata-mcp.js'
import { OpenMetadataMcpError, OpenMetadataSemanticHttpClient } from '../data-connectors/openmetadata-mcp-http.js'
import type { DashboardVisualContract } from '../dashboard-build/universal-contract.js'

const API = '/api/dsh-workbench'
const MAX_CSV_BYTES = 20 * 1024 * 1024
const MAX_BODY_BYTES = MAX_CSV_BYTES + 512 * 1024
const ASSET = /^[a-z][a-z0-9-]{2,62}$/
const REVISION = /^rev-\d{4}$/
// Resolve from this module so an installed plugin never depends on the DSH host cwd.
const DATA_AGENT_LOGO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../local-app/assets/data-agent-logo-black.png')
const JUMP_TO_LATEST_ICON_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../local-app/assets/jump-to-latest-chevron.png')
const THREE_MODULE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/three/build/three.module.js')
const THREE_CORE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/three/build/three.core.js')

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}
function page(response: ServerResponse, value: string): void { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(value) }
function source(response: ServerResponse, value: string): void { response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); response.end(value) }
function javascript(response: ServerResponse, value: string): void { response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' }); response.end(value) }
function image(response: ServerResponse, value: Buffer): void { response.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'no-store' }); response.end(value) }
function png(response: ServerResponse, value: Buffer): void { response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); response.end(value) }
function sse(response: ServerResponse, event: DashboardRunEvent | NativeDashboardRunEvent | DashboardAgentStreamEvent | { type: 'session.started'; data: { sessionId: string } }): void { response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`) }
function required(value: unknown, name: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(`${name.toUpperCase()}_REQUIRED`); return value.trim() }
function mapping(value: unknown): DashboardFieldMapping { return !value || typeof value !== 'object' || Array.isArray(value) ? {} : Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()])) }
function template(value: unknown): 'content-ops-v1' | 'finance-pnl-v1' | 'supply-sales-v1' | 'sku-operations-v1' { if (value === 'content-ops-v1' || value === 'finance-pnl-v1' || value === 'supply-sales-v1' || value === 'sku-operations-v1') return value; throw new Error('TEMPLATE_INVALID') }
function status(error: unknown): number { const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR'; return error instanceof OpenMetadataMcpError ? error.statusCode : /REQUIRED|INVALID|TOO_LARGE|CSV_|DATA_|ASSET_ID|MAPPING_|CONFIRMATION|PUBLISH_|RELEASE_|PREVIEW_|DASHBOARD_PLAN|HISTORY_/.test(message) ? 400 : /NOT_FOUND/.test(message) ? 404 : 500 }
const TEMPLATE_SELECTION_COOKIE = 'dsh-workbench-design-template'
function cookieValue(request: IncomingMessage, name: string): string | undefined { return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) }
function selectionCookie(templateId: string): string { return `${TEMPLATE_SELECTION_COOKIE}=${encodeURIComponent(templateId)}; Path=/; Max-Age=28800; SameSite=Strict; HttpOnly` }
function clearSelectionCookie(): string { return `${TEMPLATE_SELECTION_COOKIE}=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly` }

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > MAX_BODY_BYTES) throw new Error('UPLOAD_TOO_LARGE: maximum CSV size is 20 MB'); chunks.push(buffer) }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  if (!body || Array.isArray(body)) throw new Error('REQUEST_BODY_INVALID')
  if (typeof body.csv === 'string' && Buffer.byteLength(body.csv, 'utf8') > MAX_CSV_BYTES) throw new Error('UPLOAD_TOO_LARGE: maximum CSV size is 20 MB')
  return body
}

/** Same-origin loopback guard for browser UI routes. Do not expose this local library directly to the network. */
function isTrustedBrowser(request: IncomingMessage): boolean {
  if (!isLoopback(request)) return false
  return request.headers['sec-fetch-site'] === 'same-origin' || typeof request.headers.origin === 'string'
}
function isLoopback(request: IncomingMessage): boolean { return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') }
function isWorkbenchPageNavigation(request: IncomingMessage, url: URL): boolean {
  if (request.method !== 'GET' || !isLoopback(request)) return false
  return url.pathname === '/dsh-workbench'
    || url.pathname === '/dsh-workbench/templates'
    || /^\/dsh-workbench\/share\/[a-f0-9]{48}$/.test(url.pathname)
    || url.pathname === '/dsh-workbench/assets/data-agent-logo-black.png'
    || url.pathname === '/dsh-workbench/assets/jump-to-latest-chevron.png'
    || url.pathname === '/dsh-workbench/assets/three.module.js'
    || url.pathname === '/dsh-workbench/assets/three.core.js'
    || /^\/dsh-workbench\/assets\/[a-z][a-z0-9-]{2,62}\/rev-\d{4}\/(?:dashboard|source)\.html$/.test(url.pathname)
}

/** Host half of the DSH Web plugin. The browser client is only a same-origin view over these routes. */
type WorkbenchModel = {
  analyze(csv: string, businessGoal?: string): Promise<EnrichedCsvAnalysis>
  generateDashboard(input: { csv: string; fileName: string; businessGoal: string }, signal?: AbortSignal, onTextDelta?: (delta: string) => void): Promise<{ html: string; title: string; summary: string }>
}

export function makeWorkbenchWebRoutes(library: KnowledgeLibrary, modelAnalyzer?: WorkbenchModel, uploadRoot = './dsh-workbench-library', headlessAgents?: HeadlessDashboardAgentService, nativeSessions = new NativeWorkbenchSessions(uploadRoot)): WebRoute[] {
  const uploads = new AgentUploadStore(uploadRoot)
  const history = new WorkbenchHistoryStore(resolve(uploadRoot, 'history', 'build-history.json'))
  const shares = new ConversationShareStore(resolve(uploadRoot, 'history', 'shares'))
  const designTemplates = new DesignTemplateLibrary({ cacheRoot: uploadRoot })
  const templateCovers = new TemplateCoverLibrary({ cacheRoot: uploadRoot })
  const omd = new OpenMetadataSemanticHttpClient()
  const plans = new Map<string, { plan: DashboardPlan; csv: string }>()
  const planCsv = new Map<string, string>()
  const datasetForUpload = async (uploadId: string): Promise<HeadlessDatasetContext> => {
    const upload = await uploads.readCsv(uploadId)
    let dataset: HeadlessDatasetContext = { filePath: upload.filePath, fileName: upload.fileName }
    // An invalid profile must not make the already-validated upload unusable.
    try {
      const analysis = analyzeCsv(upload.csv)
      dataset = {
        ...dataset,
        rowCount: analysis.rowCount,
        fieldCount: analysis.headers.length,
        fields: analysis.headers.slice(0, 12),
        dateFields: analysis.fields.filter(field => field.inferredType === 'date').map(field => field.name).slice(0, 6),
        numberFields: analysis.fields.filter(field => field.inferredType === 'number').map(field => field.name).slice(0, 6),
      }
    } catch { /* keep the verified file attached without a derived profile */ }
    return dataset
  }
  const runs = modelAnalyzer ? new NativeDashboardRunService(modelAnalyzer, library, (assetId, revision) => `/dsh-workbench/assets/${assetId}/${revision}/dashboard.html`) : undefined
  const guarded = (handler: (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<void> | void) => ({ kind: 'prefix' as const, path: '/dsh-workbench', handler: async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (!isTrustedBrowser(request) && !isWorkbenchPageNavigation(request, url)) return json(response, 403, { error: 'FORBIDDEN' })
    try { await handler(request, response, url) } catch (error) { json(response, status(error), { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }) }
  } })
  const asset = (request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> | void => {
    const match = /^\/dsh-workbench\/assets\/([a-z][a-z0-9-]{2,62})\/(rev-\d{4})\/(dashboard|source)\.html$/.exec(url.pathname)
    if (!match || !ASSET.test(match[1]) || !REVISION.test(match[2])) return json(response, 404, { error: 'ROUTE_NOT_FOUND' })
    return library.readRevision(match[1], match[2]).then(stored => { if (match[3] === 'source') source(response, stored.html); else page(response, stored.html) })
  }
  return [
    guarded((_request, response, url) => {
      if (url.pathname === '/dsh-workbench/assets/data-agent-logo-black.png') return readFile(DATA_AGENT_LOGO_PATH).then(value => png(response, value))
      if (url.pathname === '/dsh-workbench/assets/jump-to-latest-chevron.png') return readFile(JUMP_TO_LATEST_ICON_PATH).then(value => png(response, value))
      if (url.pathname === '/dsh-workbench/assets/three.module.js') return readFile(THREE_MODULE_PATH, 'utf8').then(value => javascript(response, value))
      if (url.pathname === '/dsh-workbench/assets/three.core.js') return readFile(THREE_CORE_PATH, 'utf8').then(value => javascript(response, value))
      if (url.pathname === '/dsh-workbench' || url.pathname === '/dsh-workbench/templates') return page(response, renderLocalWorkbenchPage({ apiBase: API, initialPage: url.pathname.endsWith('/templates') ? 'templates' : 'new' }).replaceAll("fetch('/api/", `fetch('${API}/`).replaceAll('/assets/', '/dsh-workbench/assets/'))
      const sharePage = /^\/dsh-workbench\/share\/([a-f0-9]{48})$/.exec(url.pathname)
      if (_request.method === 'GET' && sharePage) return shares.read(sharePage[1]).then(snapshot => snapshot ? page(response, renderConversationShare(snapshot)) : json(response, 404, { error: '分享不存在' }))
      if (url.pathname.startsWith('/dsh-workbench/assets/')) return asset(_request, response, url)
      return json(response, 404, { error: 'ROUTE_NOT_FOUND' })
    }),
    { kind: 'prefix', path: API, handler: async (request, response): Promise<void> => {
      if (!isTrustedBrowser(request)) return json(response, 403, { error: 'FORBIDDEN' })
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      try {
        const feishuRoute = /^\/api\/dsh-workbench\/dashboards\/([a-z][a-z0-9-]{2,62})\/feishu$/.exec(url.pathname)
        if(feishuRoute) {
          if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress||'') || (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)) return json(response,403,{error:'FORBIDDEN'})
          if(!['GET','POST'].includes(request.method||'')) return json(response,405,{error:'METHOD_NOT_ALLOWED'})
          return json(response,200,await dashboardFeishu(feishuRoute[1],request.method!,request.method==='POST'?await readJson(request):{}))
        }
        const sharing = /^\/api\/dsh-workbench\/dashboards\/([a-z][a-z0-9-]{2,62})\/shares$/.exec(url.pathname)
        if (sharing) {
          if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return json(response,403,{error:'FORBIDDEN'})
          if (request.method === 'GET') return json(response,200,await dashboardShareState(library,sharing[1]))
          const body=await readJson(request)
          if (request.method === 'POST') return json(response,200,await createDashboardShare(library,sharing[1],body.days))
          if (request.method === 'DELETE') return json(response,200,await revokeDashboardShare(sharing[1],body.token))
        }
        const onlinePublish = /^\/api\/dsh-workbench\/dashboards\/([a-z][a-z0-9-]{2,62})\/publish-online$/.exec(url.pathname)
        if (request.method === 'POST' && onlinePublish) {
          const body = await readJson(request)
          if (body.confirmed !== true) throw new Error('PUBLISH_CONFIRMATION_REQUIRED')
          return json(response, 200, await publishOnline(library, onlinePublish[1]))
        }
        if (request.method === 'POST' && url.pathname === `${API}/history/share`) {
          const body = await readJson(request), shared = await shares.create(body.item)
          return json(response, 201, { url: '/dsh-workbench/share/' + shared.token, html: renderConversationShare(shared.snapshot) })
        }
        if (request.method === 'GET' && url.pathname === `${API}/history`) return json(response, 200, { history: await history.read() })
        if (request.method === 'PUT' && url.pathname === `${API}/history`) {
          const body = await readJson(request)
          return json(response, 200, { history: await history.write(body.history) })
        }
        if (request.method === 'GET' && url.pathname === `${API}/dashboards`) {
          const includeDrafts = url.searchParams.get('includeDrafts') === 'true'
          const dashboards = await Promise.all((await library.listAssets()).filter(asset => Boolean(includeDrafts ? asset.latestRevision : asset.releasedRevision)).map(async asset => {
            const revision = asset.releasedRevision ?? asset.latestRevision!
            const stored = await library.readRevision(asset.assetId, revision)
            return toDashboardSummary({ ...asset, displayName: stored.manifest.displayName }, `/dsh-workbench/assets/${encodeURIComponent(asset.assetId)}/${revision}/dashboard.html`, stored.model)
          }))
          return json(response, 200, { dashboards })
        }
        const dashboardDelete = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dashboards/([a-z][a-z0-9-]{2,62})$`).exec(url.pathname)
        if (request.method === 'DELETE' && dashboardDelete) {
          const body = await readJson(request)
          if (body.confirmed !== true) throw new Error('DELETE_CONFIRMATION_REQUIRED')
          if (!library.deleteAsset) throw new Error('DASHBOARD_DELETE_UNSUPPORTED')
          await library.deleteAsset(dashboardDelete[1])
          return json(response, 200, { deleted: true, assetId: dashboardDelete[1] })
        }
        const draftAction = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dashboard-drafts/([a-z][a-z0-9-]{2,62})/(rev-\\d{4})/(preview|release)$`).exec(url.pathname)
        if (request.method === 'POST' && draftAction) {
          const [, assetId, revision, action] = draftAction
          if (action === 'preview') {
            const stored = await library.preview(assetId, revision)
            return json(response, 200, { revision: stored.revision, previewUrl: `/dsh-workbench/assets/${encodeURIComponent(assetId)}/${revision}/dashboard.html` })
          }
          const body = await readJson(request)
          if (body.confirmed !== true) throw new Error('PUBLISH_CONFIRMATION_REQUIRED')
          const release = await library.release(assetId, revision, { approvalId: `user-confirmed:${randomUUID()}` })
          return json(response, 200, { release, dashboardUrl: `/dsh-workbench/assets/${encodeURIComponent(assetId)}/${release.revision}/dashboard.html` })
        }
        if (request.method === 'POST' && url.pathname === `${API}/analyze`) {
          const body = await readJson(request)
          const csv = required(body.csv, 'csv')
          return json(response, 200, modelAnalyzer ? await modelAnalyzer.analyze(csv) : analyzeCsv(csv))
        }
        if (request.method === 'POST' && url.pathname === `${API}/omd/search`) {
          const body = await readJson(request)
          return json(response, 200, await omd.search(required(body.query, 'omd_query')))
        }
        if (request.method === 'POST' && url.pathname === `${API}/omd/details`) {
          const body = await readJson(request)
          return json(response, 200, { asset: await omd.details(required(body.entityType, 'entityType'), required(body.fqn, 'fqn')) })
        }
        if (request.method === 'POST' && url.pathname === `${API}/dashboard-plans`) {
          const body = await readJson(request)
          const csv = required(body.csv, 'csv')
          const businessGoal = required(body.businessGoal ?? body.intent, 'businessGoal')
          const analysis = modelAnalyzer ? await modelAnalyzer.analyze(csv, businessGoal) : analyzeCsv(csv)
          const plan = planFromAnalysis(analysis, {
            planId: randomUUID(), fileName: typeof body.fileName === 'string' ? body.fileName : undefined, source: snapshotCsvSource(csv),
            businessGoal,
            title: typeof body.title === 'string' ? body.title : undefined,
            audience: Array.isArray(body.audience) ? body.audience.filter((value): value is string => typeof value === 'string') : undefined,
            decisions: Array.isArray(body.decisions) ? body.decisions.filter((value): value is string => typeof value === 'string') : undefined,
            semanticContext: body.semanticContext as SemanticContext | undefined,
            visualContract: body.visualContract as DashboardVisualContract | undefined,
            storylinePlan: body.storylinePlan as DashboardPlan['storylinePlan'] | undefined,
            templateId: body.templateId === 'content-ops-v1' || body.templateId === 'finance-pnl-v1' || body.templateId === 'supply-sales-v1' || body.templateId === 'sku-operations-v1' ? body.templateId : undefined,
            mapping: mapping(body.mapping),
          })
          plans.set(plan.planId, { plan, csv })
          return json(response, 201, { plan, analysis })
        }
        const confirmation = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dashboard-plans/([a-f0-9-]{36})/confirm$`).exec(url.pathname)
        if (request.method === 'POST' && confirmation) {
          const body = await readJson(request)
          const saved = plans.get(confirmation[1])
          if (!saved) throw new Error('DASHBOARD_PLAN_NOT_FOUND')
          const spec = confirmDashboardPlan(saved.plan, body.confirmation as DashboardPlanConfirmation)
          assertCsvMatchesSnapshot(saved.csv, spec.source)
          assertLatestPeriodComplete(saved.csv, spec.mapping.period)
          if (spec.templateId === 'sku-operations-v1') assertSkuMetricSemantics(saved.csv, spec.mapping)
          const stored = await library.buildDraft(saved.csv, { assetId: required(body.assetId, 'assetId'), templateId: spec.templateId, mapping: spec.mapping, spec, displayName: spec.title, sourceLabel: typeof body.sourceLabel === 'string' ? body.sourceLabel.trim() : undefined })
          plans.delete(confirmation[1])
          return json(response, 201, { spec, asset: stored.asset, revision: stored.revision, quality: stored.quality, dashboardUrl: `/dsh-workbench/assets/${stored.asset.assetId}/${stored.revision.revision}/dashboard.html` })
        }
        if (request.method === 'POST' && url.pathname === `${API}/uploads`) {
          const body = await readJson(request)
          const csv = required(body.csv, 'csv')
          const fileName = typeof body.fileName === 'string' ? body.fileName : 'dataset.csv'
          return json(response, 201, await uploads.saveCsv(fileName, csv))
        }
        if (request.method === 'POST' && url.pathname === `${API}/native-session-input`) {
          const body = await readJson(request)
          const sessionId = required(body.sessionId, 'sessionId')
          const uploadId = typeof body.uploadId === 'string' ? body.uploadId : undefined
          await nativeSessions.bind(sessionId, uploadId)
          // Never turn a remembered cookie or internal template specification into user speech.
          const templateId = typeof body.designTemplateId === 'string' ? body.designTemplateId : undefined
          const selectedTemplate = templateId ? await designTemplates.get(templateId) : undefined
          required(body.prompt, 'prompt')
          const prompt = body.prompt as string
          const created = await nativeSessions.prepare(sessionId, { requestId: required(body.requestId, 'requestId'), prompt, ...(uploadId ? { uploadId } : {}), ...(selectedTemplate ? { templateId, templateInstructions: withDesignTemplate('', selectedTemplate), templateSha: selectedTemplate.contentSha } : {}), ...(body.semanticAsset && typeof body.semanticAsset === 'object' ? { semanticAsset: body.semanticAsset } : {}) })
          return json(response, 200, { prompt, sessionId, replayed: !created })
        }
        if (request.method === 'POST' && url.pathname === `${API}/native-session-input/rejected`) {
          const body = await readJson(request)
          await nativeSessions.rejectPrepared(required(body.sessionId, 'sessionId'), required(body.requestId, 'requestId'))
          return json(response, 200, { ok: true })
        }
        const nativeDelivery = new RegExp(`^${API}/native-sessions/((?:session-)?[a-f0-9-]{36})$`).exec(url.pathname)
        if (request.method === 'GET' && nativeDelivery) {
          const link = await nativeSessions.read(nativeDelivery[1])
          return json(response, link ? 200 : 404, link ? { sessionId: link.sessionId, uploadId: link.uploadId, uploadIds: link.uploadIds, draft: link.draft } : { error: 'NATIVE_SESSION_LINK_NOT_FOUND' })
        }
        if (request.method === 'POST' && url.pathname === `${API}/dashboard-agent-sessions`) {
          if (!headlessAgents) throw new Error('DASHBOARD_AGENT_NOT_CONFIGURED')
          const body = await readJson(request)
          if (body.mode !== 'background') return json(response, 409, { error: 'NATIVE_SESSION_REQUIRED', message: '交互式对话请使用 DSH 原生会话。Headless 仅用于显式后台任务。' })
          const uploadId = typeof body.uploadId === 'string' ? body.uploadId : undefined
          const dataset = uploadId ? await datasetForUpload(uploadId) : undefined
          return json(response, 201, { sessionId: await headlessAgents.create(dataset) })
        }
        const dashboardAgentMessage = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dashboard-agent-sessions/([a-f0-9-]{36})/messages$`).exec(url.pathname)
        if (request.method === 'POST' && dashboardAgentMessage) {
          if (!headlessAgents) throw new Error('DASHBOARD_AGENT_NOT_CONFIGURED')
          const body = await readJson(request)
          if (body.mode !== 'background') return json(response, 409, { error: 'NATIVE_SESSION_REQUIRED' })
          // Older workbench documents persist in an open browser tab while a
          // local plugin is rebuilt. They receive text deltas but their base
          // renderer does not paint `stream.output`. Keep a temporary visual
          // mirror in the already-supported tool lane for those documents;
          // current documents declare version 2 and render normal prose only.
          const legacyTextRenderer = body.clientRenderVersion !== 2
          let legacyPublicText = ''
          const legacyReplyCallId = 'legacy-public-reply'
          const sessionId = dashboardAgentMessage[1]
          if (!headlessAgents.exists(sessionId)) throw new Error('DASHBOARD_AGENT_SESSION_NOT_FOUND')
          response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' })
          response.flushHeaders()
          response.write(': connected\n\n')
          let closed = false
          const close = (): void => {
            if (closed) return
            closed = true
            unsubscribe()
            response.end()
          }
          const unsubscribe = headlessAgents.subscribe(sessionId, event => {
            if (closed) return
            if (legacyTextRenderer && event.type === 'assistant.delta' && event.data.text) {
              legacyPublicText += event.data.text
              sse(response, {
                type: 'tool.started',
                data: { callId: legacyReplyCallId, title: `智能体回复：${legacyPublicText}` },
              })
            }
            if (legacyTextRenderer && legacyPublicText && (event.type === 'agent.completed' || event.type === 'agent.stopped' || event.type === 'agent.error')) {
              sse(response, {
                type: 'tool.completed',
                data: { callId: legacyReplyCallId, title: `智能体回复：${legacyPublicText}`, failed: event.type === 'agent.error' },
              })
            }
            sse(response, event)
            if (event.type === 'agent.completed' || event.type === 'agent.stopped' || event.type === 'agent.error') close()
          })
          response.once('close', close)
          sse(response, { type: 'session.started', data: { sessionId } })
          try {
            const templateId = typeof body.designTemplateId === 'string' ? body.designTemplateId : cookieValue(request, TEMPLATE_SELECTION_COOKIE)
            const prompt = templateId ? withDesignTemplate(required(body.prompt, 'prompt'), await designTemplates.get(templateId)) : required(body.prompt, 'prompt')
            headlessAgents.send(sessionId, prompt)
          } catch (error) { sse(response, { type: 'agent.error', data: { message: error instanceof Error ? error.message : '无法发送消息' } }); close() }
          return
        }
        const dashboardAgentCancel = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/dashboard-agent-sessions/([a-f0-9-]{36})/cancel$`).exec(url.pathname)
        if (request.method === 'POST' && dashboardAgentCancel) {
          if (!headlessAgents) throw new Error('DASHBOARD_AGENT_NOT_CONFIGURED')
          return json(response, 200, { cancelled: headlessAgents.cancel(dashboardAgentCancel[1]) })
        }
        if (request.method === 'GET' && url.pathname === `${API}/design-templates`) {
          const result = await designTemplates.listResult()
          return json(response, 200, { ...result, templates: await templateCovers.cards(result.templates, `${API}/design-templates`) })
        }
        if (request.method === 'POST' && url.pathname === `${API}/design-templates/sync`) {
          const result = await designTemplates.syncResult()
          return json(response, 200, { ...result, templates: await templateCovers.cards(result.templates, `${API}/design-templates`) })
        }
        if (request.method === 'POST' && url.pathname === `${API}/design-templates/selection`) {
          const body = await readJson(request)
          const detail = await designTemplates.get(required(body.templateId, 'templateId'))
          return json(response, 200, { selected: true, template: toBrowserTemplate(detail) }, { 'set-cookie': selectionCookie(detail.id) })
        }
        if (request.method === 'DELETE' && url.pathname === `${API}/design-templates/selection`) {
          return json(response, 200, { selected: false }, { 'set-cookie': clearSelectionCookie() })
        }
        const designTemplate = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/design-templates/([a-z0-9][a-z0-9.-]{1,80})$`, 'i').exec(url.pathname)
        const templateBuild = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/design-templates/([a-z0-9][a-z0-9.-]{1,80})/(?:build|retry)$`, 'i').exec(url.pathname)
        if (request.method === 'POST' && templateBuild) return json(response, 200, await templateCovers.build(await designTemplates.get(templateBuild[1]), `${API}/design-templates`))
        const templatePreview = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/design-templates/([a-z0-9][a-z0-9.-]{1,80})/preview$`, 'i').exec(url.pathname)
        if (request.method === 'GET' && templatePreview) { const preview = await templateCovers.preview(await designTemplates.get(templatePreview[1])); return preview ? page(response, preview) : json(response, 404, { error: 'TEMPLATE_PREVIEW_NOT_BUILT' }) }
        const templateCover = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/design-templates/([a-z0-9][a-z0-9.-]{1,80})/cover\\.webp$`, 'i').exec(url.pathname)
        if (request.method === 'GET' && templateCover) { const cover = await templateCovers.cover(await designTemplates.get(templateCover[1])); return cover ? image(response, cover) : json(response, 404, { error: 'TEMPLATE_COVER_NOT_BUILT' }) }
        if (request.method === 'GET' && designTemplate) {
          return json(response, 200, { template: toBrowserTemplate(await designTemplates.get(designTemplate[1])) })
        }
        if (request.method === 'POST' && url.pathname === `${API}/runs`) {
          if (!runs) throw new Error('DSH_MODEL_NOT_CONFIGURED')
          const body = await readJson(request)
          const templateId = typeof body.designTemplateId === 'string' ? body.designTemplateId : cookieValue(request, TEMPLATE_SELECTION_COOKIE)
          const intent = templateId ? withDesignTemplate(required(body.intent, 'intent'), await designTemplates.get(templateId)) : required(body.intent, 'intent')
          const uploadId = required(body.uploadId, 'uploadId')
          const file = await uploads.readCsv(uploadId)
          const run = runs.start({ csv: file.csv, fileName: file.fileName, intent })
          response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' })
          response.write(': connected\n\n')
          for await (const event of run.events()) sse(response, event)
          response.end()
          return
        }
        const cancel = new RegExp(`^${API.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/runs/([a-f0-9-]{36})/cancel$`).exec(url.pathname)
        if (request.method === 'POST' && cancel) return json(response, 200, { cancelled: runs?.cancel(cancel[1]) ?? false })
        return json(response, 404, { error: 'ROUTE_NOT_FOUND' })
      } catch (error) { return json(response, status(error), { error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }) }
    } },
  ]
}
