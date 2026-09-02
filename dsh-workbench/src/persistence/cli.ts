import { createPostgresCoreStore } from './index.js'

const store = createPostgresCoreStore()
try {
  const applied = await store.migrate()
  console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database schema is already current.')
} finally {
  await store.close()
}
