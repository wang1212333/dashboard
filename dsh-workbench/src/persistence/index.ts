import { Pool, type PoolConfig } from 'pg'
import { PostgresCoreStore } from './postgres-store.js'

export * from './contracts.js'
export * from './migrate.js'
export * from './postgres-store.js'

/** Creates the server-only persistence layer from DATABASE_URL. */
export function createPostgresCoreStore(databaseUrl = process.env.DATABASE_URL): PostgresCoreStore {
  if (!databaseUrl) throw new Error('DATABASE_URL_REQUIRED')
  const config: PoolConfig = { connectionString: databaseUrl, max: 10, application_name: 'dsh-workbench-metadata' }
  return new PostgresCoreStore(new Pool(config))
}
