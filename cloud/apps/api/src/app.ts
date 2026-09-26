import { Hono } from 'hono'
import { MemoryAccountStore, type AccountStore } from './account-store.js'
import type { ArtifactStore } from './artifact-store.js'
import { createAuthenticator } from './auth.js'
import { desktopAuthRoutes } from './desktop-auth.js'
import { artifactRoutes, sharedPageRoutes } from './artifacts.js'
import type { ApiConfig } from './config.js'
import type { SkillStore } from './skill-store.js'
import { skillRoutes, skillSharePageRoutes } from './skills.js'

export function createApp(config: ApiConfig, stores: { artifacts: ArtifactStore; skills: SkillStore; accounts?: AccountStore }, now: () => Date = () => new Date()) {
  const accounts = stores.accounts ?? new MemoryAccountStore()
  const authenticate = createAuthenticator(config, accounts, now)
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ ok: true }))
  app.route('/v1/desktop/auth', desktopAuthRoutes(config, accounts, now))
  app.route('/v1/artifacts', artifactRoutes(config, stores.artifacts, authenticate, now))
  app.route('/a', sharedPageRoutes(stores.artifacts, now))
  app.route('/v1', skillRoutes(config, stores.skills, authenticate, now))
  app.route('/skills/share', skillSharePageRoutes(stores.skills))
  // The desktop's API calls send `redirect: 'error'`, so only the browser sign-in page redirects; unknown paths are a plain 404.
  app.notFound((c) => c.json({ code: 'not_found', message: 'Not found.' }, 404))
  app.onError((err, c) => {
    console.error('[api] request failed', err)
    return c.json({ code: 'temporary_failure', message: 'Something went wrong. Try again.' }, 500)
  })
  return app
}
