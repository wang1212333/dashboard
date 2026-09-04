/**
 * Browser half of dsh-workbench. It deliberately uses plain DOM rather than
 * the host React tree: DSH owns that tree, while this plugin owns only its
 * sidebar row and a disposable conversation-column workbench overlay.
 */
export const inject = ['sessions', 'workspaces']

type SessionDriver = {
  rename(title: string): Promise<unknown>
  prompt(content: readonly unknown[], mode: 'queue'): Promise<{ ok: true } | { ok: false; error: unknown }>
  cancel?(): Promise<{ ok?: boolean; accepted?: boolean; error?: unknown } | unknown>
  getSnapshot?(): ConversationSnapshot
  subscribe?(listener: () => void): () => void
}
type AssistantBlock = { kind?: unknown; text?: unknown; callId?: unknown; name?: unknown; argsRaw?: unknown }
type ConversationNode = { kind?: unknown; seq?: unknown; blocks?: readonly AssistantBlock[]; callId?: unknown; call?: { name?: unknown; argsRaw?: unknown } | null; isError?: unknown }
type ConversationSnapshot = {
  running?: boolean
  nodes?: readonly ConversationNode[]
  partial?: { blocks?: readonly AssistantBlock[] } | null
  runningCalls?: readonly { name?: unknown }[]
}
type WorkbenchEvent = {
  id: string
  type: 'analysis' | 'tool' | 'insight' | 'artifact' | 'error'
  status: 'running' | 'completed' | 'failed'
  title: string
  summary?: string
  icon?: 'file' | 'terminal' | 'calculate' | 'verify' | 'artifact'
}
type SessionsFace = {
  binding(sessionId: string): { session: SessionDriver } | undefined
  open(sessionId: string): void
}
type WorkspaceItem = { workspaceId: string; title?: string; path?: string }
type WorkspacesFace = {
  list: { getSnapshot(): { items: readonly WorkspaceItem[]; recentWorkspaceId?: string } }
  connectWorkspace(workspaceId: string): Promise<string>
}
type ClientContext = { get(name: string): unknown }
type WorkbenchMessage = {
  source?: unknown
  kind?: unknown
  requestId?: unknown
  title?: unknown
  intent?: unknown
  filePath?: unknown
  sourceMode?: unknown
  semanticAsset?: unknown
  profile?: unknown
  sessionId?: unknown
  designTemplate?: unknown
}
type DatasetProfile = { fileName: string; rowCount: number; fieldCount: number; fields: string[]; dateFields: string[]; numberFields: string[] }
type DesignStyle = { id: string; name: string; description?: string; primaryColor?: string; styleGuide?: string }
type SemanticAsset = { fqn: string; entityType: string; name: string; description?: string; columns: string[]; glossaryTerms?: string[]; tags?: string[]; owners?: string[] }
type AgentRunMessage = { requestId: string; title: string; intent: string; filePath?: string; profile?: DatasetProfile; designTemplate?: DesignStyle; sourceMode?: 'omd'; semanticAsset?: SemanticAsset }

const ENTRY = '[data-dsh-workbench-entry]'
const VIEW = '[data-dsh-workbench-view]'
const ACTIVE = 'data-dsh-workbench-active'
const STYLE = 'dsh-workbench-client-style'
const SUPPLIED_WORKBENCH_ICON_SOURCE = 'data:image/png;base64,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'
// The workbench entry uses the supplied chart-card artwork directly, so it is
// identical in the expanded and compact sidebar without waiting for the frame.
const WORKBENCH_ICON = '<img class="dsh-workbench-entry-icon" src="data:image/png;base64,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" alt="" aria-hidden="true">'

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [data-slot="sidebar"], [class*="sidebarCol"]')
  if (!column) return undefined
  return column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement ?? (column.firstElementChild as HTMLElement | undefined)
}
function centerColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('[data-pane="conversation"], [data-slot="conversation"], [class*="centerCol"]') ?? undefined
}
function installStyle(): void {
  if (document.getElementById(STYLE)) return
  const style = document.createElement('style'); style.id = STYLE
  style.textContent = `[data-dsh-workbench-entry]{display:flex !important;align-items:center;gap:8px;width:100% !important;min-width:0;border:0;background:transparent;color:inherit;padding:8px 10px;border-radius:7px;font:inherit;cursor:pointer;text-align:left}[data-dsh-workbench-entry]:not([data-compact])>span:last-child{display:block !important;min-width:0;white-space:nowrap}[data-dsh-workbench-entry] .dsh-workbench-entry-icon{width:18px;height:18px;flex:0 0 auto;object-fit:contain}[data-dsh-workbench-entry]:hover{background:color-mix(in srgb,currentColor 8%,transparent)}[data-dsh-workbench-entry][data-active]{background:transparent;color:inherit}[data-dsh-workbench-entry][data-compact]{justify-content:center;width:40px !important;height:40px;margin:0 auto;padding:0;border-radius:8px}[data-dsh-workbench-entry][data-compact]>span:last-child{display:none !important}[data-pane="conversation"],[class*="centerCol"]{position:relative}[data-dsh-workbench-view]{display:none;position:absolute;inset:0;z-index:60;background:#fff}[${ACTIVE}] [data-dsh-workbench-view]{display:block}[${ACTIVE}] [data-pane="conversation"]>:not([data-dsh-workbench-view]),[${ACTIVE}] [class*="centerCol"]>:not([data-dsh-workbench-view]){display:none !important}[data-dsh-workbench-frame]{width:100%;height:100%;border:0;background:#fff}`
  document.head.append(style)
}
function createEntry(toggle: () => void): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.dshWorkbenchEntry = ''; button.dataset.dshPlugin = 'workbench'; button.setAttribute('aria-label', '看板工作台')
  button.innerHTML = `${WORKBENCH_ICON}<span>看板工作台</span>`
  const entryIcon = button.querySelector<HTMLImageElement>('.dsh-workbench-entry-icon')
  if (entryIcon) entryIcon.src = SUPPLIED_WORKBENCH_ICON_SOURCE
  // The DSH shell also listens on the sidebar. Keep this interaction owned by this plugin.
  button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggle() })
  return button
}
function directChild(container: HTMLElement, descendant: Element): Element | undefined {
  let node: Element | null = descendant
  while (node?.parentElement && node.parentElement !== container) node = node.parentElement
  return node?.parentElement === container ? node : undefined
}
function isVisible(element: Element): boolean {
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}
/**
 * DSH's auxiliary plugins are independent overlays. Ask an open plugin to
 * return to the conversation before displaying this one, rather than leaving
 * two competing overlay states in the center pane.
 */
function returnFromForeignPluginViews(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-dsh-plugin]:not([data-dsh-plugin="workbench"]) [aria-label="返回会话"]')]
    .filter(button => isVisible(button) && button.closest('[data-dsh-plugin]') !== null)
  for (const button of buttons) button.click()
}

/** DSH calls this from the package's ./client export. Mount failures are isolated from the shell. */
export function apply(ctx: ClientContext): void {
  if (typeof document === 'undefined' || document.querySelector(ENTRY)) return
  installStyle()
  const sessions = ctx.get('sessions') as SessionsFace
  const workspaces = ctx.get('workspaces') as WorkspacesFace
  let entry: HTMLButtonElement | undefined; let view: HTMLDivElement | undefined; let frame: HTMLIFrameElement | undefined; let entryResizeObserver: ResizeObserver | undefined
  const syncEntryCompact = (): void => {
    const sidebar = sidebarRoot()
    entry?.toggleAttribute('data-compact', Boolean(sidebar && sidebar.getBoundingClientRect().width <= 88))
  }
  const close = (): void => {
    document.documentElement.removeAttribute(ACTIVE); entry?.removeAttribute('data-active')
  }
  const open = (): void => {
    returnFromForeignPluginViews()
    document.documentElement.setAttribute(ACTIVE, ''); entry?.setAttribute('data-active', 'true')
  }
  const toggle = (): void => document.documentElement.hasAttribute(ACTIVE) ? close() : open()
  const ensure = (): void => {
    const sidebar = sidebarRoot()
    if (sidebar && !entry?.isConnected) {
      entry ??= createEntry(toggle)
      const skills = [...sidebar.querySelectorAll('button')].find(button => button.textContent?.trim() === '技能中心')
      const anchor = skills ? directChild(sidebar, skills) : undefined
      // Keep the entry in the product navigation, immediately after “技能中心”.
      if (anchor?.nextSibling) sidebar.insertBefore(entry, anchor.nextSibling)
      else if (anchor) sidebar.append(entry)
      else sidebar.append(entry)
    }
    if (entry) {
      syncEntryCompact()
      if (!entryResizeObserver && typeof ResizeObserver !== 'undefined') {
        entryResizeObserver = new ResizeObserver(syncEntryCompact)
        entryResizeObserver.observe(entry)
      }
    }
    const center = centerColumn()
    if (center && !view?.isConnected) {
      view ??= document.createElement('div'); view.dataset.dshWorkbenchView = ''; view.dataset.dshPlugin = 'workbench'
      frame ??= document.createElement('iframe'); frame.dataset.dshWorkbenchFrame = ''; frame.title = 'DSH 看板工作台'; frame.src = '/dsh-workbench?embedded=2'
      view.replaceChildren(frame)
      if (getComputedStyle(center).position === 'static') center.style.position = 'relative'
      center.append(view)
    }
  }
  const observer = new MutationObserver(ensure); observer.observe(document.body, { childList: true, subtree: true }); ensure()
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null
    if (target?.closest('[class*="sessionRow"],[class*="projectRow"],[class*="newSession"]')) close()
  }, true)
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.documentElement.hasAttribute(ACTIVE)) close()
  })
  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return
    const message = event.data as WorkbenchMessage
    if (message?.source !== 'dsh-workbench') return
    if (message.kind === 'close-workbench') { close(); return }
    if (typeof message.requestId !== 'string') return
    if (message.kind === 'open-session' && typeof message.sessionId === 'string') {
      close(); sessions.open(message.sessionId)
      return
    }
    if (message.kind === 'load-session' && typeof message.sessionId === 'string') {
      loadSessionTimeline(message.requestId, message.sessionId, sessions, frame)
      return
    }
    if (message.kind === 'stop-agent' && typeof message.sessionId === 'string') {
      void stopAgent(message.requestId, message.sessionId, sessions, frame)
      return
    }
    if (message.kind !== 'run-agent' || typeof message.title !== 'string' || typeof message.intent !== 'string') return
    const asset = semanticAsset(message.semanticAsset)
    const omdSource = message.sourceMode === 'omd'
    if ((!omdSource && typeof message.filePath !== 'string') || (omdSource && !asset)) return
    void runInWorkspace({ requestId: message.requestId, title: message.title, intent: message.intent, filePath: typeof message.filePath === 'string' ? message.filePath : undefined, profile: datasetProfile(message.profile), designTemplate: designStyle(message.designTemplate), sourceMode: omdSource ? 'omd' : undefined, semanticAsset: asset }, sessions, workspaces, frame)
  })
}

async function stopAgent(requestId: string, sessionId: string, sessions: SessionsFace, frame: HTMLIFrameElement | undefined): Promise<void> {
  const reply = (payload: Record<string, unknown>): void => frame?.contentWindow?.postMessage({ source: 'dsh-workbench', requestId, ...payload }, window.location.origin)
  const driver = sessions.binding(sessionId)?.session
  if (!driver?.cancel) {
    reply({ kind: 'agent-stop-failed', message: '当前 DSH 会话不支持取消；请在完整会话中停止任务。' })
    return
  }
  try {
    await driver.cancel()
    reply({ kind: 'agent-stopped', sessionId })
  } catch (error) {
    reply({ kind: 'agent-stop-failed', message: error instanceof Error ? error.message : '停止任务失败' })
  }
}

function loadSessionTimeline(requestId: string, sessionId: string, sessions: SessionsFace, frame: HTMLIFrameElement | undefined): void {
  const reply = (payload: Record<string, unknown>): void => frame?.contentWindow?.postMessage({ source: 'dsh-workbench', requestId, ...payload }, window.location.origin)
  const driver = sessions.binding(sessionId)?.session
  const snapshot = driver?.getSnapshot?.()
  if (!driver || !snapshot) {
    reply({ kind: 'history-load-failed', message: '该会话暂时无法读取；已保留本地过程记录。' })
    return
  }
  const running = Boolean(snapshot.running)
  const latestCall = snapshot.runningCalls?.at(-1)
  reply({ kind: 'history-loaded', sessionId, timeline: timelineFromSnapshot(snapshot, running), running, activity: typeof latestCall?.name === 'string' ? toolLabel(latestCall.name) : undefined, assistantText: assistantTextFromSnapshot(snapshot) })
  if (running) mirrorAgentOutput(driver, reply)
}

async function runInWorkspace(message: AgentRunMessage, sessions: SessionsFace, workspaces: WorkspacesFace, frame: HTMLIFrameElement | undefined): Promise<void> {
  const reply = (payload: Record<string, unknown>): void => frame?.contentWindow?.postMessage({ source: 'dsh-workbench', requestId: message.requestId, ...payload }, window.location.origin)
  try {
    const snapshot = workspaces.list.getSnapshot()
    const workspace = snapshot.items.find(item => item.workspaceId === snapshot.recentWorkspaceId) ?? snapshot.items[0]
    if (workspace === undefined) throw new Error('未找到可用的 DSH 工作区，请先在主界面创建或打开一个工作区。')
    const sessionId = await workspaces.connectWorkspace(workspace.workspaceId)
    const driver = sessions.binding(sessionId)?.session
    if (driver === undefined) throw new Error('DSH 会话尚未就绪，请重试。')
    await driver.rename(message.title)
    const accepted = await driver.prompt([{ type: 'text', text: agentPrompt(message.intent, message.filePath, message.profile, message.designTemplate, message.semanticAsset) }], 'queue')
    if (!accepted.ok) throw new Error(String(accepted.error))
    reply({ kind: 'agent-started', sessionId, workspaceId: workspace.workspaceId, workspaceTitle: workspace.title || workspace.path || '当前工作区' })
    mirrorAgentOutput(driver, reply)
  } catch (error) {
    reply({ kind: 'agent-failed', message: error instanceof Error ? error.message : '无法启动 Agent 会话' })
  }
}

function textFromBlocks(blocks: readonly AssistantBlock[] | undefined): string {
  return (blocks ?? [])
    .filter(block => block.kind === 'text')
    .map(block => typeof block.text === 'string' ? block.text : '')
    .filter(Boolean)
    .join('\n\n')
}

type ToolDisplay = Pick<WorkbenchEvent, 'title' | 'summary' | 'icon'>

function commandText(argsRaw: unknown): string {
  if (typeof argsRaw === 'string') return argsRaw
  if (!argsRaw || typeof argsRaw !== 'object') return ''
  const args = argsRaw as Record<string, unknown>
  return [args.command, args.script, args.cmd, args.path].filter(value => typeof value === 'string').join(' ')
}

/** Map opaque DSH tool names to a concise, user-facing action and outcome. */
function toolDisplay(name: unknown, argsRaw?: unknown): ToolDisplay {
  const tool = typeof name === 'string' ? name.toLowerCase() : ''
  const command = commandText(argsRaw).toLowerCase()
  if (tool.includes('read') || /get-content|import-csv|convertfrom-csv/.test(command)) {
    return { title: '读取数据文件', summary: '已获取字段、样本与数据规模', icon: 'file' }
  }
  if (/measure-object|group-object|select-object|sort-object|sum\(|avg\(|average/.test(command)) {
    return { title: '计算与汇总指标', summary: '已得到后续看板所需的统计结果', icon: 'calculate' }
  }
  if (/set-content|add-content|out-file|new-item|writealltext|dashboard\.html/.test(command) || tool.includes('write') || tool.includes('patch')) {
    return { title: '生成看板文件', summary: '已写入 HTML 产物', icon: 'terminal' }
  }
  if (/test-path|select-string|validate|check/.test(command)) {
    return { title: '校验数据与看板', summary: '已确认关键文件和口径', icon: 'verify' }
  }
  if (/get-childitem|dir\b|ls\b|glob|list/.test(command) || tool.includes('list') || tool.includes('glob')) {
    return { title: '检查工作区文件', summary: '已确认可用输入与产物位置', icon: 'file' }
  }
  if (tool.includes('pwsh') || tool.includes('exec') || tool.includes('command')) {
    return { title: '运行数据处理命令', summary: '命令结果已用于后续分析', icon: 'terminal' }
  }
  return { title: typeof name === 'string' ? `执行 ${name}` : '执行数据分析步骤', summary: '执行结果已用于后续分析', icon: 'terminal' }
}

function toolLabel(name: unknown, argsRaw?: unknown): string {
  return toolDisplay(name, argsRaw).title
}

function safeSummary(text: string): string | undefined {
  const cleaned = safeAssistantText(text)
    ?.replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, 280) + (cleaned.length > 280 ? '…' : '')
}

/** User-visible assistant prose only. Hidden reasoning and generated source stay in the DSH session. */
function safeAssistantText(text: string): string | undefined {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, 1_200) + (cleaned.length > 1_200 ? '…' : '')
}

function assistantTextFromSnapshot(snapshot: ConversationSnapshot): string | undefined {
  const partial = safeAssistantText(textFromBlocks(snapshot.partial?.blocks))
  if (partial) return partial
  const lastAssistant = [...(snapshot.nodes ?? [])].reverse().find(node => node.kind === 'assistant')
  return safeAssistantText(textFromBlocks(lastAssistant?.blocks))
}

function timelineFromSnapshot(snapshot: ConversationSnapshot, running: boolean): WorkbenchEvent[] {
  const events = new Map<string, WorkbenchEvent>()
  const calls = new Map<string, { name: unknown; argsRaw?: unknown }>()
  for (const node of snapshot.nodes ?? []) {
    if (node.kind !== 'assistant') continue
    const seq = typeof node.seq === 'number' ? String(node.seq) : 'unknown'
    for (const block of node.blocks ?? []) {
      if (block.kind !== 'tool-call') continue
      const callId = typeof block.callId === 'string' ? block.callId : `${seq}:${String(block.name ?? 'tool')}`
      calls.set(callId, { name: block.name, argsRaw: block.argsRaw })
    }
  }
  for (const node of snapshot.nodes ?? []) {
    const seq = typeof node.seq === 'number' ? String(node.seq) : 'unknown'
    if (node.kind === 'tool-result') {
      const callId = typeof node.callId === 'string' ? node.callId : seq
      const call = calls.get(callId)
      const display = toolDisplay(call?.name ?? node.call?.name, call?.argsRaw ?? node.call?.argsRaw)
      events.set(`tool:${callId}`, { id: `tool:${callId}`, type: 'tool', status: node.isError ? 'failed' : 'completed', ...display, summary: node.isError ? '执行未完成，请在完整会话中查看原因。' : display.summary })
      continue
    }
    if (node.kind !== 'assistant') continue
    for (const block of node.blocks ?? []) {
      if (block.kind !== 'tool-call') continue
      const callId = typeof block.callId === 'string' ? block.callId : `${seq}:${String(block.name ?? 'tool')}`
      if (!events.has(`tool:${callId}`)) {
        const display = toolDisplay(block.name, block.argsRaw)
        events.set(`tool:${callId}`, { id: `tool:${callId}`, type: 'tool', status: 'running', ...display, summary: '正在执行，完成后会展示结果。' })
      }
    }
  }
  const lastAssistant = [...(snapshot.nodes ?? [])].reverse().find(node => node.kind === 'assistant')
  const finalSummary = safeSummary(textFromBlocks(lastAssistant?.blocks))
  if (finalSummary && !running) {
    events.set('insight:final', { id: 'insight:final', type: 'insight', status: 'completed', title: '分析结论已生成', summary: finalSummary })
    if (/dashboard\.html/i.test(finalSummary)) events.set('artifact:dashboard', { id: 'artifact:dashboard', type: 'artifact', status: 'completed', title: '看板产物已生成', summary: '已生成 HTML 看板，可在完整会话中查看保存路径与交付说明。' })
  }
  return [...events.values()]
}

/** Forward structured, user-facing progress from the supported DSH session snapshot. */
function mirrorAgentOutput(driver: SessionDriver, reply: (payload: Record<string, unknown>) => void): void {
  if (!driver.getSnapshot || !driver.subscribe) return
  let dispose: (() => void) | undefined
  let sawRunning = false
  const forward = (): void => {
    const snapshot = driver.getSnapshot?.()
    if (!snapshot) return
    const latestCall = snapshot.runningCalls?.at(-1)
    if (snapshot.running) sawRunning = true
    const running = Boolean(snapshot.running)
    const timeline = timelineFromSnapshot(snapshot, running)
    reply({ kind: 'agent-update', running, timeline: sawRunning ? timeline : [], activity: typeof latestCall?.name === 'string' ? toolLabel(latestCall.name) : undefined, assistantText: assistantTextFromSnapshot(snapshot) })
    const lastAssistant = [...(snapshot.nodes ?? [])].reverse().find(node => node.kind === 'assistant')
    if (sawRunning && !snapshot.running && lastAssistant) {
      reply({ kind: 'agent-complete', timeline, activity: undefined, assistantText: assistantTextFromSnapshot(snapshot) })
      dispose?.()
    }
  }
  dispose = driver.subscribe(forward)
  forward()
}

function datasetProfile(value: unknown): DatasetProfile | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const profile = value as Record<string, unknown>
  if (typeof profile.fileName !== 'string' || typeof profile.rowCount !== 'number' || typeof profile.fieldCount !== 'number' || !Array.isArray(profile.fields)) return undefined
  const strings = (items: unknown): string[] => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string').slice(0, 12) : []
  return { fileName: profile.fileName, rowCount: profile.rowCount, fieldCount: profile.fieldCount, fields: strings(profile.fields), dateFields: strings(profile.dateFields), numberFields: strings(profile.numberFields) }
}

function designStyle(value: unknown): DesignStyle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return undefined
  return {
    id: record.id.slice(0, 81),
    name: record.name.slice(0, 120),
    description: typeof record.description === 'string' ? record.description.slice(0, 600) : undefined,
    primaryColor: typeof record.primaryColor === 'string' ? record.primaryColor.slice(0, 16) : undefined,
    styleGuide: typeof record.styleGuide === 'string' ? record.styleGuide.slice(0, 2_800) : undefined,
  }
}

function semanticAsset(value: unknown): SemanticAsset | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.fqn !== 'string' || typeof record.entityType !== 'string' || typeof record.name !== 'string') return undefined
  const strings = (input: unknown): string[] => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string').map(item => item.slice(0, 300)) : []
  return { fqn: record.fqn.slice(0, 800), entityType: record.entityType.slice(0, 80), name: record.name.slice(0, 180), description: typeof record.description === 'string' ? record.description.slice(0, 1_200) : undefined, columns: strings(record.columns).slice(0, 80), glossaryTerms: strings(record.glossaryTerms).slice(0, 40), tags: strings(record.tags).slice(0, 40), owners: strings(record.owners).slice(0, 40) }
}

function agentPrompt(intent: string, filePath?: string, profile?: DatasetProfile, designTemplate?: DesignStyle, asset?: SemanticAsset): string {
  const verifiedProfile = profile
    ? `\n\n系统已在上传时验证的数据画像（这是事实基线；你仍须用工具读取文件复核）：\n- 文件：${profile.fileName}\n- 记录数：${profile.rowCount}\n- 字段数：${profile.fieldCount}\n- 字段：${profile.fields.join('、') || '未提取'}${profile.dateFields.length ? `\n- 已识别时间字段：${profile.dateFields.join('、')}` : ''}${profile.numberFields.length ? `\n- 已识别数值字段：${profile.numberFields.join('、')}` : ''}`
    : ''
  void designTemplate
  if (asset) return `用户需求：${intent}\n\n用户选择的数据资产：\n- 名称：${asset.name}\n- 类型：${asset.entityType}\n- FQN：${asset.fqn}${asset.description ? `\n- 描述：${asset.description}` : ''}${asset.columns.length ? `\n- 字段：${asset.columns.join('、')}` : ''}${asset.glossaryTerms?.length ? `\n- 术语：${asset.glossaryTerms.join('、')}` : ''}\n\n请自行决定如何使用可用的 MCP 工具、数据和网页能力完成用户请求。不要套用预置看板模板、Plan、确认或 Spec 流程。`
  if (!filePath) throw new Error('DATA_SOURCE_REQUIRED')
  return `用户需求：${intent}\n\n数据文件（CSV，已在本机保存）：${filePath}${verifiedProfile}\n\n这是原生 DeepSeek Harness 看板任务。请自主读取和理解数据，自行决定信息架构、指标、图表、交互、视觉与实现方式，直接生成能够满足用户目标的完整看板。你可以按需要使用可用工具；不使用预设模板、字段映射、Plan、确认、Spec 或确定性渲染流程。完成后使用 workbench_save_generated_dashboard 保存完整 HTML；它只会保存为会话内草稿，用户将在页面中预览并明确确认后才会发布到“我的看板”。`
}
