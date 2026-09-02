import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { analyzeCsv } from './csv-profile.js'

/** A small, verified description of an uploaded file that is safe to show in the workbench. */
export type UploadedCsvProfile = {
  fileName: string
  rowCount: number
  fieldCount: number
  fields: string[]
  dateFields: string[]
  numberFields: string[]
}

/**
 * Persists browser uploads outside the conversation transcript so a DSH
 * Agent can read the data from a stable local path instead of receiving CSV
 * rows as prompt tokens. This P1 local adapter intentionally keeps all files
 * under the configured workbench library root.
 */
export class AgentUploadStore {
  private readonly root: string

  constructor(libraryRoot: string) {
    this.root = resolve(libraryRoot, 'agent-inputs')
  }

  async saveCsv(fileName: string, csv: string): Promise<{ uploadId: string; filePath: string; profile?: UploadedCsvProfile }> {
    const uploadId = randomUUID()
    const safeName = sanitizeCsvName(fileName)
    const directory = resolve(this.root, uploadId)
    const filePath = resolve(directory, safeName)
    // `safeName` has no path separators, so this stays below `directory`.
    await mkdir(directory, { recursive: true })
    await writeFile(filePath, csv, { encoding: 'utf8', flag: 'wx' })
    // Parsing happens on the server, before an Agent sees the file.  This gives
    // the conversation a durable factual record without putting CSV rows into
    // the prompt.  Keep the upload usable even when a malformed CSV cannot be
    // profiled; the Agent can then report its own read error.
    try {
      const analysis = analyzeCsv(csv)
      return {
        uploadId,
        filePath,
        profile: {
          fileName: safeName,
          rowCount: analysis.rowCount,
          fieldCount: analysis.headers.length,
          fields: analysis.headers.slice(0, 12),
          dateFields: analysis.fields.filter(field => field.inferredType === 'date').map(field => field.name).slice(0, 6),
          numberFields: analysis.fields.filter(field => field.inferredType === 'number').map(field => field.name).slice(0, 6),
        },
      }
    } catch {
      return { uploadId, filePath }
    }
  }

  /** Resolves an opaque browser upload id; callers never need to trust a browser supplied path. */
  async readCsv(uploadId: string): Promise<{ fileName: string; filePath: string; csv: string }> {
    if (!/^[a-f0-9-]{36}$/i.test(uploadId)) throw new Error('UPLOAD_ID_INVALID')
    const directory = resolve(this.root, uploadId)
    try {
      const fileName = (await readdir(directory)).find(name => name.toLowerCase().endsWith('.csv'))
      if (!fileName) throw new Error('UPLOAD_NOT_FOUND')
      const filePath = resolve(directory, fileName)
      const csv = await readFile(filePath, 'utf8')
      return { fileName, filePath, csv }
    } catch {
      throw new Error('UPLOAD_NOT_FOUND')
    }
  }
}

function sanitizeCsvName(input: string): string {
  const name = basename(input).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return name.toLowerCase().endsWith('.csv') && name.length > 4 ? name : 'dataset.csv'
}
