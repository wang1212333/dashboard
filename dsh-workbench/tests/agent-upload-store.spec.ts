import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentUploadStore } from '../src/data-ingestion/agent-upload-store.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('AgentUploadStore', () => {
  it('writes the complete CSV beneath the controlled library root and returns an absolute path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-upload-'))
    roots.push(root)
    const stored = await new AgentUploadStore(root).saveCsv('../利润宽表.csv', 'month,revenue\n2026-08,100')
    expect(stored.filePath.startsWith(root)).toBe(true)
    expect(stored.filePath).toMatch(/agent-inputs/)
    expect(stored.profile).toMatchObject({ rowCount: 1, fieldCount: 2, fields: ['month', 'revenue'], dateFields: ['month'], numberFields: ['revenue'] })
    await expect(readFile(stored.filePath, 'utf8')).resolves.toBe('month,revenue\n2026-08,100')
  })
})
