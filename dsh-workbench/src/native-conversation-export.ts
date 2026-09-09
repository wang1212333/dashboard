type Block = { type?: unknown; kind?: unknown; text?: unknown }
type Node = { kind?: unknown; content?: readonly Block[]; blocks?: readonly Block[] }
type Snapshot = { running?: boolean; hasMore?: boolean; openState?: string; nodes?: readonly Node[] }
type Driver = { open?(): Promise<void>; loadOlder?(): Promise<void>; getSnapshot?(): Snapshot }

/** Export only finalized, public native text; never copy reasoning, context, tools or attachments. */
export async function exportNativeConversation(driver: Driver) {
  await driver.open?.()
  let snapshot = driver.getSnapshot?.()
  if (!snapshot || snapshot.running) throw new Error('请等待当前回复完成后再分享完整对话。')
  for (let page = 0; snapshot.hasMore; page++) {
    if (!driver.loadOlder || page >= 100) throw new Error('历史记录尚未完整加载，未生成不完整快照。')
    const before = snapshot.nodes?.length
    await driver.loadOlder()
    snapshot = driver.getSnapshot?.()
    if (!snapshot || (snapshot.hasMore && snapshot.nodes?.length === before)) throw new Error('历史记录加载失败，请重试。')
  }
  if (snapshot.running) throw new Error('会话正在生成，请稍后分享。')
  const messages: { role: 'user' | 'assistant'; text: string }[] = []
  for (const node of snapshot.nodes ?? []) {
    const user = node.kind === 'user' || node.kind === 'steering'
    if (!user && node.kind !== 'assistant') continue
    const text = (user ? node.content ?? [] : node.blocks ?? []).filter(block => (user ? block.type : block.kind) === 'text' && typeof block.text === 'string').map(block => block.text as string).join('\n')
    if (text.trim()) messages.push({ role: user ? 'user' : 'assistant', text })
  }
  if (!messages.length) throw new Error('没有可分享的原生正文。')
  if (new TextEncoder().encode(JSON.stringify(messages)).length > 2 * 1024 * 1024) throw new Error('对话过大，无法生成完整快照。')
  return messages
}
