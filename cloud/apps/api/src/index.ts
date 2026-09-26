import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { MemoryArtifactStore, type ArtifactStore } from './artifact-store.js'
import { loadConfig } from './config.js'
import { PgArtifactStore } from './pg-artifact-store.js'

const config = loadConfig()
const artifacts: ArtifactStore = config.databaseUrl ? new PgArtifactStore(config.databaseUrl) : new MemoryArtifactStore()
await artifacts.migrate()
if (!config.databaseUrl) {
  console.warn('[api] DATABASE_URL is not set: artifacts are kept in memory and lost on restart.')
}

const server = serve({ fetch: createApp(config, { artifacts }).fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[api] listening on :${info.port}, sharing as ${config.publicUrl}${config.devAuth ? ' (dev auth on)' : ''}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close()
    void artifacts.close().finally(() => process.exit(0))
  })
}
