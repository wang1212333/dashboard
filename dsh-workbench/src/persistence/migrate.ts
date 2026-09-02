import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Pool, PoolClient } from 'pg'

const migration = {
  id: '001_core_persistence',
  path: fileURLToPath(new URL('../../migrations/001_core_persistence.sql', import.meta.url)),
}

/** Applies each schema migration exactly once. Run from the metadata service, never from a browser route. */
export async function migratePostgres(pool: Pool): Promise<string[]> {
  const client = await pool.connect()
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`)
    const applied = await client.query<{ id: string }>('SELECT id FROM schema_migrations WHERE id = $1', [migration.id])
    if (applied.rowCount) return []

    const sql = await readFile(migration.path, 'utf8')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
      await client.query('COMMIT')
      return [migration.id]
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  } finally {
    client.release()
  }
}

export type SqlTransaction = Pick<PoolClient, 'query'>
