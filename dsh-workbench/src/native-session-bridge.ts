export type NativeSessionDriver = {
  rename(title: string): Promise<unknown>
  prompt(content: readonly unknown[], mode: 'queue'): Promise<{ ok: true } | { ok: false; error: unknown }>
}
export type NativeSessions = {
  list: { getSnapshot(): { current?: string; byId: Record<string, { cwd?: string }> } }
  binding(sessionId: string): { session: NativeSessionDriver } | undefined
  open(sessionId: string): void
  create(options: { workspaceId: string; sessionId?: string }): Promise<string>
}
export type NativeWorkspaces = {
  list: { getSnapshot(): { items: readonly { workspaceId: string; title?: string; path?: string }[]; recentWorkspaceId?: string; baselinesReady?: boolean } }
  connectWorkspace(workspaceId: string): Promise<string>
}

/** No Agent creation, model selection, transcript projection or fallback session here. */
export async function submitNativeSession(input: {
  sessionId?: string
  workspaceId?: string
  title: string
  prepare(sessionId: string): Promise<string>
  onBound(sessionId: string): void
  onRejected?(sessionId: string): Promise<void>
}, sessions: NativeSessions, workspaces: NativeWorkspaces): Promise<string> {
  let sessionId = input.sessionId
  const existing = Boolean(sessionId)
  const snapshot = workspaces.list.getSnapshot()
  if (snapshot.baselinesReady === false) throw new Error('DSH 工作区列表尚在加载，请稍后重试。')
  const normalizePath = (path?: string) => path?.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  const items = snapshot.items.filter(item => item.path && !/(?:^|[\\/])agent-inputs(?:[\\/]|$)/i.test(item.path))
  const sessionList = sessions.list.getSnapshot()
  if (sessionId) {
    const cwd = sessionList.byId[sessionId]?.cwd
    if (cwd && !items.some(item => normalizePath(item.path) === normalizePath(cwd))) throw new Error('原会话未关联可用的真实 DSH 工作区，可能是旧版后台会话。可打开原生会话查看记录；继续搭建请明确点击“新建看板”，不会替换原会话。')
  }
  if (!sessionId) {
    const currentCwd = sessionList.current ? sessionList.byId[sessionList.current]?.cwd : undefined
    const workspace = input.workspaceId ? items.find(item => item.workspaceId === input.workspaceId) : items.find(item => normalizePath(item.path) === normalizePath(currentCwd)) ?? (items.length === 1 ? items[0] : undefined)
    if (!workspace) throw new Error('未找到 DSH 工作区，请先在 DSH 中打开真实项目目录。')
    // Reserve a task-owned native identity; never borrow another blank conversation.
    sessionId = 'session-' + crypto.randomUUID()
    input.onBound(sessionId)
    sessionId = await sessions.create({ workspaceId: workspace.workspaceId, sessionId })
  }
  const driver = sessions.binding(sessionId)?.session
  if (!driver) throw new Error('原 DSH 会话尚未加载或已不可用。请在原生侧栏确认该会话后重试；不会创建替代会话。')
  // Preserve the exact id even if preparation or submission fails.
  input.onBound(sessionId)
  const prompt = await input.prepare(sessionId)
  if (!existing) await driver.rename(input.title)
  // Native staging owns transcript hydration, permissions, questions and live chunks.
  sessions.open(sessionId)
  const result = await driver.prompt([{ type: 'text', text: prompt }], 'queue')
  if (!result.ok) { await input.onRejected?.(sessionId); throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error)) }
  return sessionId
}
