import { Hono } from 'hono'
import type { ArtifactStore } from './artifact-store.js'
import { artifactRoutes, sharedPageRoutes } from './artifacts.js'
import type { ApiConfig } from './config.js'

export function createApp(config: ApiConfig, stores: { artifacts: ArtifactStore }, now: () => Date = () => new Date()) {
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ ok: true }))
  app.route('/v1/artifacts', artifactRoutes(config, stores.artifacts, now))
  app.route('/a', sharedPageRoutes(stores.artifacts, now))
  // The desktop sends `redirect: 'error'`, so nothing here may answer with a 3xx; unknown paths are a plain 404.
  app.notFound((c) => c.json({ code: 'not_found', message: 'Not found.' }, 404))
  app.onError((err, c) => {
    console.error('[api] request failed', err)
    return c.json({ code: 'temporary_failure', message: 'Something went wrong. Try again.' }, 500)
  })
  return app
}
