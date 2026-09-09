import { mkdir, readFile, readdir, rename, writeFile, unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentUploadStore } from './data-ingestion/agent-upload-store.js'

export type NativeDraft = { assetId: string; revision: string; title: string }
export type NativeTaskInput = { requestId: string; prompt: string; uploadId?: string; templateId?: string; templateInstructions?: string; templateSha?: string; semanticAsset?: unknown; messageId?: string; turn?: number }
type NativeLink = { sessionId: string; uploadId?: string; uploadIds?: string[]; draft?: NativeDraft; inputs?: NativeTaskInput[] }

/** Attachment/delivery references only. DSH remains the owner of the session and turn state. */
export class NativeWorkbenchSessions {
  private readonly root: string
  readonly uploads: AgentUploadStore
  private readonly pending = new Map<string, Promise<void>>()
  constructor(libraryRoot: string) {
    this.root = resolve(libraryRoot, 'native-sessions')
    this.uploads = new AgentUploadStore(libraryRoot)
  }
  private path(sessionId: string): string {
    if (!/^(?:session-)?[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sessionId)) throw new Error('SESSION_ID_INVALID')
    return resolve(this.root, sessionId + '.json')
  }
  async read(sessionId: string): Promise<NativeLink | undefined> {
    try { return JSON.parse(await readFile(this.path(sessionId), 'utf8')) as NativeLink }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
  private async save(link: NativeLink): Promise<void> {
    const path = this.path(link.sessionId)
    await mkdir(this.root, { recursive: true })
    const temporary = path + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, JSON.stringify(link), { encoding: 'utf8', flag: 'wx' })
    try {
      // Windows scanners/readers can briefly hold the destination open. Retain
      // atomic replacement: never delete or truncate the last valid snapshot.
      for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, path); break }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt >= 5) throw error
          await delay(25 * 2 ** attempt)
        }
      }
    } finally { await unlink(temporary).catch(() => {}) }
  }
  async bind(sessionId: string, uploadId?: string): Promise<void> {
    this.path(sessionId)
    if (uploadId) await this.uploads.readCsv(uploadId)
    await this.update(sessionId, link => ({ ...link, sessionId, ...(uploadId ? { uploadId, uploadIds: [...new Set([...(link?.uploadIds ?? []), ...(link?.uploadId ? [link.uploadId] : []), uploadId])] } : {}) }))
  }
  async dataset(sessionId: string, uploadId?: string) {
    const link = await this.read(sessionId)
    const selected = uploadId ?? link?.uploadId
    if (!selected || !link) return undefined
    if (selected !== link.uploadId && !link.uploadIds?.includes(selected)) throw new Error('UPLOAD_NOT_ATTACHED_TO_SESSION')
    return this.uploads.readCsv(selected)
  }
  async recordDraft(sessionId: string, draft: NativeDraft): Promise<void> {
    await this.update(sessionId, link => link ? { ...link, draft } : undefined)
  }
  async draftSources(): Promise<Record<string, string>> {
    const sources: Record<string, string> = {}
    const files = await readdir(this.root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
    for (const file of files.filter(file => /^(?:session-)?[a-f0-9-]+\.json$/i.test(file))) {
      const link = await this.read(file.slice(0, -5))
      if (link?.draft) sources[link.draft.assetId] = link.sessionId
    }
    return sources
  }
  /** Immutable per-submission snapshots; never infer a running turn's file from the latest upload. */
  async prepare(sessionId: string, input: NativeTaskInput): Promise<boolean> {
    let created = false
    await this.update(sessionId, link => {
      if (!link) throw new Error('NATIVE_SESSION_NOT_BOUND')
      const previous = link.inputs?.find(value => value.requestId === input.requestId)
      if (previous) {
        if (JSON.stringify({ ...previous, messageId: undefined, turn: undefined }) !== JSON.stringify(input)) throw new Error('REQUEST_ID_CONFLICT')
        return link
      }
      if (link.inputs?.some(value => !value.messageId)) throw new Error('NATIVE_SUBMISSION_PENDING: 上一次提交尚未确认，不能覆盖其附件上下文；请等待原生会话恢复或明确新建任务。')
      created = true
      return { ...link, inputs: [...(link.inputs ?? []), input] }
    })
    return created
  }
  async rejectPrepared(sessionId: string, requestId: string): Promise<void> {
    await this.update(sessionId, link => link ? { ...link, inputs: link.inputs?.filter(value => value.requestId !== requestId || value.messageId) } : undefined)
  }
  async claim(sessionId: string, messageId: string, prompt: string, turn: number): Promise<NativeTaskInput | undefined> {
    let claimed: NativeTaskInput | undefined
    await this.update(sessionId, link => {
      if (!link) return undefined
      const inputs = [...(link.inputs ?? [])]
      const index = inputs.findIndex(value => value.messageId === messageId)
      const match = index >= 0 ? index : inputs.findIndex(value => !value.messageId && value.prompt === prompt)
      if (match < 0) return link
      claimed = { ...inputs[match], messageId, turn }
      inputs[match] = claimed
      return { ...link, inputs }
    })
    return claimed
  }
  async inputForTurn(sessionId: string, turn: number): Promise<NativeTaskInput | undefined> {
    return [...((await this.read(sessionId))?.inputs ?? [])].reverse().find(value => value.turn === turn)
  }
  private async update(sessionId: string, change: (link: NativeLink | undefined) => NativeLink | undefined): Promise<void> {
    const previous = this.pending.get(sessionId) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      const current = await this.read(sessionId)
      const value = change(current)
      if (value && JSON.stringify(value) !== JSON.stringify(current)) await this.save(value)
    })
    this.pending.set(sessionId, next)
    try { await next } finally { if (this.pending.get(sessionId) === next) this.pending.delete(sessionId) }
  }
}
