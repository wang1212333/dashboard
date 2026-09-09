import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Message = { role: 'user' | 'assistant'; text: string }
export type ConversationSnapshot = { title: string; createdAt: string; messages: Message[] }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Allow-list only visible conversation text. No tools, file paths, attachments or asset URLs. */
export function conversationSnapshot(value: unknown): ConversationSnapshot {
  const item = record(value)
  if (typeof item.title !== 'string' || !item.title.trim()) throw new Error('SHARE_INVALID')
  const turns = Array.isArray(item.messages) ? item.messages.map(value => {
    const message = record(value)
    return { stream: message.role === 'user' ? { question: message.text } : message.role === 'assistant' ? { output: message.text } : {} }
  }) : Array.isArray(item.turns) && item.turns.length ? item.turns : [{ stream: item.stream }]
  const messages: Message[] = []
  for (const turn of turns) {
    const wrapper = record(turn), stream = record(wrapper.stream ?? turn)
    if (typeof stream.question === 'string' && stream.question.trim()) messages.push({ role: 'user', text: stream.question })
    if (typeof stream.output === 'string' && stream.output.trim()) messages.push({ role: 'assistant', text: stream.output })
  }
  if (!messages.length) throw new Error('SHARE_EMPTY')
  const snapshot = { title: item.title.trim().slice(0, 200), createdAt: new Date().toISOString(), messages }
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2 * 1024 * 1024) throw new Error('SHARE_TOO_LARGE')
  return snapshot
}

export class ConversationShareStore {
  constructor(private readonly root: string) {}
  async create(value: unknown): Promise<{ token: string; snapshot: ConversationSnapshot }> {
    const snapshot = conversationSnapshot(value), token = randomBytes(24).toString('hex')
    await mkdir(this.root, { recursive: true })
    await writeFile(resolve(this.root, `${token}.json`), JSON.stringify(snapshot), { encoding: 'utf8', flag: 'wx' })
    return { token, snapshot }
  }
  async read(token: string): Promise<ConversationSnapshot | null> {
    if (!/^[a-f0-9]{48}$/.test(token)) return null
    try { return JSON.parse(await readFile(resolve(this.root, `${token}.json`), 'utf8')) as ConversationSnapshot }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
}

export function renderConversationShare(snapshot: ConversationSnapshot): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(snapshot.title)} · 对话快照</title><style>body{margin:0;background:#fff;color:#252525;font:15px/1.8 'Microsoft YaHei',sans-serif}main{max-width:800px;margin:56px auto;padding:0 24px}header{border-bottom:1px solid #e8e8e8;padding-bottom:24px}h1{font-size:26px;overflow-wrap:anywhere}header p,small{color:#777;font-size:12px}.message{margin:32px 0}.message p{white-space:pre-wrap;overflow-wrap:anywhere}.user{background:#f5f5f5;padding:16px 20px;border-radius:12px}.message strong{font-size:13px}footer{border-top:1px solid #eee;padding-top:20px;color:#888;font-size:12px}</style></head><body><main><header><small>看板工作台 · 只读分享</small><h1>${escape(snapshot.title)}</h1><p>分享时的文字快照 · 不含附件、工具执行记录或看板访问权限</p></header>${snapshot.messages.map(message => `<section class="message ${message.role}"><strong>${message.role === 'user' ? '用户' : '通用数据智能体'}</strong><p>${escape(message.text)}</p></section>`).join('')}<footer>生成时间：${escape(snapshot.createdAt)} · 后续对话不会自动更新到此快照</footer></main></body></html>`
}
