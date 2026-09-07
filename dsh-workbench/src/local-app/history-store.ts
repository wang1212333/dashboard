import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type WorkbenchHistoryItem = Record<string, unknown> & {
  sessionId: string
  title: string
  createdAt: number
}

const MAX_HISTORY_BYTES = 16 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeWorkbenchHistory(value: unknown): WorkbenchHistoryItem[] {
  if (!Array.isArray(value)) throw new Error('HISTORY_INVALID')
  const newestBySession = new Map<string, WorkbenchHistoryItem>()
  for (const valueItem of value) {
    if (!isRecord(valueItem) || typeof valueItem.sessionId !== 'string' || !valueItem.sessionId.trim() || typeof valueItem.title !== 'string' || !valueItem.title.trim() || !Number.isFinite(valueItem.createdAt)) continue
    const item = JSON.parse(JSON.stringify(valueItem)) as WorkbenchHistoryItem
    const existing = newestBySession.get(item.sessionId)
    if (!existing || item.createdAt >= existing.createdAt) newestBySession.set(item.sessionId, item)
  }
  const history = [...newestBySession.values()].sort((left, right) => right.createdAt - left.createdAt)
  if (Buffer.byteLength(JSON.stringify(history), 'utf8') > MAX_HISTORY_BYTES) throw new Error('HISTORY_TOO_LARGE')
  return history
}

/** Stores the browser workbench's recoverable session index alongside local dashboard assets. */
export class WorkbenchHistoryStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly filePath: string) {}

  async read(): Promise<WorkbenchHistoryItem[]> {
    try {
      const document = JSON.parse(await readFile(this.filePath, 'utf8')) as { history?: unknown }
      return normalizeWorkbenchHistory(document.history ?? [])
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async write(value: unknown): Promise<WorkbenchHistoryItem[]> {
    const history = normalizeWorkbenchHistory(value)
    const operation = this.pending.catch(() => undefined).then(() => this.commit(history))
    this.pending = operation
    return operation
  }

  private async commit(history: WorkbenchHistoryItem[]): Promise<WorkbenchHistoryItem[]> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`
    await writeFile(temporaryPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), history }, null, 2), 'utf8')
    await rename(temporaryPath, this.filePath)
    return history
  }
}
