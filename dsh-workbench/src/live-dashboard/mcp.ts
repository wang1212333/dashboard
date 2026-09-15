import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
export type Row = Record<string, string | null>
export type Connection = { url: string; token: string }
export async function connection(): Promise<Connection> {
  if (process.env.DSH_LIVE_MCP_URL && process.env.DSH_LIVE_MCP_TOKEN) return { url: process.env.DSH_LIVE_MCP_URL, token: process.env.DSH_LIVE_MCP_TOKEN }
  try { return JSON.parse(await readFile(process.env.DSH_LIVE_CONFIG_FILE || join(homedir(), '.config/dsh-workbench/live-source.json'), 'utf8')) as Connection } catch { throw Error('尚未配置实时数据源，请由管理员配置 DSH_LIVE_MCP_URL 和 DSH_LIVE_MCP_TOKEN') }
}
export const fingerprint = (c: Connection) => createHash('sha256').update(JSON.stringify(c)).digest('hex')
export function textResult(result: any): string {
  if (result?.isError) throw Error('数据源拒绝查询，请检查授权或查询口径')
  return (result?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
}
export function parseRows(result: any): Row[] {
  const text = textResult(result), lines = text.split(/\r?\n/), divider = lines.findIndex(l => /^-{10,}$/.test(l.trim()))
  const count=/^返回行数:\s*(\d+)\b/m.exec(text)
  if(divider<1&&count&&Number(count[1])===0)return []
  if (divider < 1) throw Error('数据源结果格式不支持')
  const keys = lines[divider - 1].split(' | ').map(s => s.trim())
  const rows = lines.slice(divider + 1).filter(s => s.trim()).map(line => {
    const values = line.split(' | ').map(s => s.trim())
    if (values.length !== keys.length) throw Error('查询列数不一致')
    return Object.fromEntries(keys.map((k, i) => [k, /^(null|none)$/i.test(values[i]) ? null : values[i]]))
  })
  if (Number(count?.[1]) !== rows.length || rows.length >= 5000) throw Error('查询结果可能不完整，请缩小范围')
  return rows
}
class Client {
  private session?: string
  private protocol = '2024-11-05'
  private ready = false
  constructor(readonly config: Connection) {}
  private async request(method: string, params?: unknown, notification = false): Promise<any> {
    const id = randomUUID()
    if (new URL(this.config.url).protocol !== 'https:') throw Error('实时数据源必须使用 HTTPS')
    const response = await fetch(this.config.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { authorization: 'Bearer ' + this.config.token, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.protocol, ...(this.session ? { 'Mcp-Session-Id': this.session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notification ? {} : { id }) }) })
    if (!response.ok) { await response.body?.cancel(); throw Error('MCP 请求失败（HTTP '+response.status+'），请检查网关响应或连接状态') }
    this.session = response.headers.get('Mcp-Session-Id') || this.session
    if (notification) { await response.body?.cancel(); return {} }
    let payload: any
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = ''
      try { while (!payload) { const chunk = await reader.read(); if (chunk.done) break; buffer += decoder.decode(chunk.value, { stream: true }); let end: number; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1); if (!line.startsWith('data:')) continue; try { const item = JSON.parse(line.slice(5)); if (item.id === id) payload = item } catch {} } } } finally { await reader.cancel() }
    } else payload = await response.json()
    if (!payload || payload.error) throw Error('MCP 请求失败')
    return payload.result
  }
  async call(name: string, args: unknown): Promise<any> {
    if (!this.ready) { const result = await this.request('initialize', { protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: 'dsh-live-dashboard', version: '0.1' } }); this.protocol = result.protocolVersion; await this.request('notifications/initialized', {}, true); this.ready = true }
    return this.request('tools/call', { name, arguments: args })
  }
}
export class LiveRuntime {
  private slots: Array<{ scope?: string; client?: Client; busy: boolean }> = [{ busy: false }, { busy: false }]
  private waiting: Array<() => void> = []
  private inFlight = new Map<string, Promise<any>>()
  async coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key); if (existing) return existing
    if (this.inFlight.size >= 8) throw Error('查询繁忙，请稍后重试')
    const promise = Promise.resolve().then(work); this.inFlight.set(key, promise)
    try { return await promise } finally { this.inFlight.delete(key) }
  }
  async call(name: string, args: unknown): Promise<{ result: any; timing: Record<string, unknown> }> {
    const config = await connection(), scope = fingerprint(config), queued = Date.now()
    if (this.waiting.length >= 24) throw Error('查询队列已满')
    let slot = this.slots.find(s => !s.busy)
    while (!slot) { await new Promise<void>(resolve => this.waiting.push(resolve)); slot = this.slots.find(s => !s.busy) }
    slot.busy = true; const started = Date.now(), reused = slot.scope === scope && Boolean(slot.client)
    try {
      if (!reused) { slot.client = new Client(config); slot.scope = scope }
      const result = await slot.client!.call(name, args)
      return { result, timing: { stage: name, queueMs: started - queued, executionMs: Date.now() - started, sessionReused: reused } }
    } catch (error) { slot.client = undefined; throw error } finally { slot.busy = false; this.waiting.shift()?.() }
  }
}
export const runtime = new LiveRuntime()
export type AuthorizedTable = { table: string; datasource: string; dialect: string }
export async function tables(): Promise<AuthorizedTable[]> {
  const text = textResult((await runtime.call('list_tables', {})).result)
  return [...text.matchAll(/^([\w]+\.[\w]+)\s+数据源\(([^)]+)\).*类型\(([^)]+)\)/gm)].map(m => ({ table: m[1], datasource: m[2], dialect: m[3] }))
}
export async function describe(table: string, datasource: string) {
  const allowed = (await tables()).find(t => t.table === table && t.datasource === datasource)
  if (!allowed) throw Error('当前连接未授权此数据表')
  const text = textResult((await runtime.call('describe_table', { table_name: table })).result)
  const fields = parseSchemaFields(text)
  if (!fields.length) throw Error('无法识别字段结构，不执行猜测查询')
  return { ...allowed, fields }
}

export function parseSchemaFields(text:string) {
  return text.split(/\r?\n/).map(line=>/^(\w+)[ \t]+(.+?)[ \t]+(?:YES|NO)(?:[ \t]+(.*))?$/.exec(line)).filter((m):m is RegExpExecArray=>Boolean(m)).map(m=>({name:m[1],type:m[2],description:(m[3]??'').trim()}))
}
