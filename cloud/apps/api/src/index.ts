import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { MemoryArtifactStore, type ArtifactStore } from './artifact-store.js'
import { loadConfig } from './config.js'
import { PgArtifactStore } from './pg-artifact-store.js'
import { PgSkillStore } from './pg-skill-store.js'
import { MemoryAccountStore, type AccountStore } from './account-store.js'
import { PgAccountStore } from './pg-account-store.js'
import { MemorySkillStore, type SkillStore } from './skill-store.js'

const config = loadConfig()
const artifacts: ArtifactStore = config.databaseUrl ? new PgArtifactStore(config.databaseUrl) : new MemoryArtifactStore()
const skills: SkillStore = config.databaseUrl ? new PgSkillStore(config.databaseUrl) : new MemorySkillStore()
const accounts: AccountStore = config.databaseUrl ? new PgAccountStore(config.databaseUrl) : new MemoryAccountStore()
await accounts.migrate()
await artifacts.migrate()
await skills.migrate()
if (!config.databaseUrl) {
  console.warn('[api] DATABASE_URL is not set: artifacts and skills are kept in memory and lost on restart.')
}

const server = serve({ fetch: createApp(config, { artifacts, skills, accounts }).fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
  console.log(`[api] listening on :${info.port}, sharing as ${config.publicUrl}${config.devAuth ? ' (dev auth on)' : ''}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close()
    void Promise.all([artifacts.close(), skills.close(), accounts.close()]).finally(() => process.exit(0))
  })
}
