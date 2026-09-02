import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { migratePostgres } from '../src/persistence/migrate.js'
import { PostgresCoreStore } from '../src/persistence/postgres-store.js'

const workspaceId = 'c0a80111-1111-4111-8111-111111111111'
const uploadId = 'c0a80111-2222-4222-8222-222222222222'
const sha256 = 'a'.repeat(64)

describe('PostgreSQL persistence schema', () => {
  it('defines every authoritative entity and keeps binary content out of the database schema', async () => {
    const schema = await readFile(new URL('../migrations/001_core_persistence.sql', import.meta.url), 'utf8')
    for (const table of ['workspaces', 'workspace_members', 'analysis_sessions', 'conversation_messages', 'agent_runs', 'run_steps', 'semantic_contexts', 'dashboard_plans', 'dashboard_specs', 'dashboard_revisions', 'artifacts', 'audit_events', 'approvals', 'uploads']) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
    expect(schema).toContain('dashboard_revisions_one_released_idx')
    expect(schema).toContain('artifact_sha256_hex')
    expect(schema).not.toMatch(/csv_body|html_body|blob\s+NOT NULL/i)
  })

  it('applies the schema once in a transaction', async () => {
    const query = vi.fn(async (sql: string) => sql.startsWith('SELECT') ? { rowCount: 0, rows: [] } : { rowCount: 0, rows: [] })
    const client = { query, release: vi.fn() } as unknown as PoolClient
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool
    await expect(migratePostgres(pool)).resolves.toEqual(['001_core_persistence'])
    expect(query).toHaveBeenCalledWith('BEGIN')
    expect(query).toHaveBeenCalledWith('COMMIT')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS workspaces'))
  })

  it('stores upload metadata as an object reference and rejects invalid hashes', async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [] }))
    const store = new PostgresCoreStore({ query } as unknown as Pool)
    await store.createUpload({
      id: uploadId,
      workspaceId,
      uploadedByUserId: 'user-1',
      source: 'local_file',
      originalFileName: 'metrics.csv',
      object: { objectUri: 's3://dsh/workspaces/demo/uploads/metrics.csv', sha256, byteSize: 42, mediaType: 'text/csv' },
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO uploads'), expect.arrayContaining([workspaceId, sha256]))
    await expect(store.createUpload({
      workspaceId,
      uploadedByUserId: 'user-1',
      source: 'local_file',
      originalFileName: 'metrics.csv',
      object: { objectUri: 's3://dsh/x', sha256: 'not-a-hash', byteSize: 42, mediaType: 'text/csv' },
    })).rejects.toThrow('SHA256_INVALID')
  })
})
