import { randomBytes } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { Authenticate, Caller } from './auth.js'
import type { ApiConfig } from './config.js'
import type { ArtifactStore, StoredArtifact } from './artifact-store.js'
import { notFoundPage, renderArtifact, SHARED_PAGE_HEADERS } from './render.js'

/** The desktop's `ARTIFACT_MAX_REQUEST_BYTES` and content limit. */
const MAX_REQUEST_BYTES = 11 * 1024 * 1024
const MAX_CONTENT_BYTES = 10 * 1024 * 1024
const PAGE_SIZE = 50

const writeBodySchema = z.object({
  content: z.string(),
  contentType: z.enum(['text/html', 'text/markdown']),
  fileName: z.string().min(1).max(255),
  title: z.string().max(500).optional()
})

function slug(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return [...randomBytes(12)].map((byte) => alphabet[byte % alphabet.length]).join('')
}

function error(c: Context, status: 400 | 401 | 403 | 404 | 413 | 422, code: string, message: string) {
  return c.json({ code, message }, status)
}

/** The desktop's `ArtifactMetadata` and `ArtifactListItem`. */
function toListItem(config: ApiConfig, artifact: StoredArtifact) {
  return {
    artifact: {
      version: 1 as const,
      slug: artifact.slug,
      title: artifact.title,
      originalFileName: artifact.originalFileName,
      sourceContentType: artifact.sourceContentType,
      renderedContentType: 'text/html' as const,
      createdAt: artifact.createdAt.toISOString(),
      updatedAt: artifact.updatedAt.toISOString(),
      expiresAt: artifact.expiresAt.toISOString(),
      byteSize: artifact.byteSize,
      deletedAt: artifact.deletedAt?.toISOString() ?? null
    },
    shareUrl: `${config.publicUrl}/a/${artifact.slug}`
  }
}

/**
 * The desktop's artifact contract (`src/main/artifacts/artifact-cloud-request.ts`,
 * `src/shared/artifacts.ts`): list, create (idempotent, returns an edit token),
 * update and unshare with that token, and owner delete without it. Content is
 * inline JSON; the public page is `/a/<slug>`.
 */
export function artifactRoutes(config: ApiConfig, store: ArtifactStore, authenticate: Authenticate, now: () => Date = () => new Date()) {
  const api = new Hono<{ Variables: { caller: Caller } }>()

  api.use('*', async (c, next) => {
    const caller = await authenticate(c.req.header('authorization'))
    if (!caller) {
      return error(c, 401, 'invalid_access_token', 'Sign in to Kingu cloud again.')
    }
    c.set('caller', caller)
    await next()
  })

  const readBody = async (c: Context) => {
    const length = Number(c.req.header('content-length') ?? 0)
    if (length > MAX_REQUEST_BYTES) {
      return { error: error(c, 413, 'artifact_too_large', 'The artifact is larger than 10 MiB.') }
    }
    const parsed = writeBodySchema.safeParse(await c.req.json().catch(() => undefined))
    if (!parsed.success) {
      return { error: error(c, 422, 'artifact_validation_failed', parsed.error.issues[0]?.message ?? 'Invalid artifact.') }
    }
    const byteSize = Buffer.byteLength(parsed.data.content, 'utf8')
    if (byteSize > MAX_CONTENT_BYTES) {
      return { error: error(c, 413, 'artifact_too_large', 'The artifact is larger than 10 MiB.') }
    }
    return { body: parsed.data, byteSize }
  }

  const expiry = (from: Date) => new Date(from.getTime() + config.artifactTtlDays * 86_400_000)

  api.get('/', async (c) => {
    const page = await store.listByOwner(c.get('caller').userId, PAGE_SIZE, c.req.query('cursor'), now())
    return c.json({ artifacts: page.artifacts.map((artifact) => toListItem(config, artifact)), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) })
  })

  api.post('/', async (c) => {
    const caller = c.get('caller')
    const idempotencyKey = c.req.header('idempotency-key') ?? null
    if (idempotencyKey) {
      // A replayed create returns the original artifact and the same edit token; the client follows up with a PUT if the body changed.
      const existing = await store.findByIdempotencyKey(caller.userId, idempotencyKey)
      if (existing) {
        return c.json({ ...toListItem(config, existing), editToken: existing.editToken }, 200)
      }
    }
    const read = await readBody(c)
    if (read.error) {
      return read.error
    }
    const at = now()
    const artifact: StoredArtifact = {
      slug: slug(),
      ownerId: caller.userId,
      title: read.body.title ?? null,
      originalFileName: read.body.fileName,
      sourceContentType: read.body.contentType,
      content: read.body.content,
      renderedHtml: renderArtifact(read.body.contentType, read.body.content, read.body.title ?? null),
      byteSize: read.byteSize,
      editToken: randomBytes(24).toString('base64url'),
      idempotencyKey,
      createdAt: at,
      updatedAt: at,
      expiresAt: expiry(at),
      deletedAt: null
    }
    await store.insert(artifact)
    return c.json({ ...toListItem(config, artifact), editToken: artifact.editToken }, 201)
  })

  api.put('/:slug', async (c) => {
    const existing = await store.findBySlug(c.req.param('slug'))
    if (!existing || existing.deletedAt || existing.expiresAt <= now()) {
      return error(c, 404, 'artifact_not_found', 'This artifact is no longer shared.')
    }
    if (existing.ownerId !== c.get('caller').userId || c.req.header('x-kingu-edit-token') !== existing.editToken) {
      return error(c, 403, 'artifact_forbidden', 'You cannot change this artifact.')
    }
    const read = await readBody(c)
    if (read.error) {
      return read.error
    }
    const at = now()
    const updated: StoredArtifact = {
      ...existing,
      title: read.body.title ?? existing.title,
      originalFileName: read.body.fileName,
      sourceContentType: read.body.contentType,
      content: read.body.content,
      renderedHtml: renderArtifact(read.body.contentType, read.body.content, read.body.title ?? existing.title),
      byteSize: read.byteSize,
      updatedAt: at,
      expiresAt: expiry(at)
    }
    await store.update(updated)
    return c.json(toListItem(config, updated))
  })

  // Unshare with the edit token, or delete as the owner without it; both leave the link dead.
  api.delete('/:slug', async (c) => {
    const existing = await store.findBySlug(c.req.param('slug'))
    if (!existing || existing.deletedAt) {
      return error(c, 404, 'artifact_not_found', 'This artifact is no longer shared.')
    }
    const editToken = c.req.header('x-kingu-edit-token')
    if (existing.ownerId !== c.get('caller').userId || (editToken !== undefined && editToken !== existing.editToken)) {
      return error(c, 403, 'artifact_forbidden', 'You cannot delete this artifact.')
    }
    await store.update({ ...existing, deletedAt: now() })
    return c.body(null, 204)
  })

  return api
}

/** `GET /a/<slug>` (and `?embed=1`, the desktop's preview): the shared page itself. */
export function sharedPageRoutes(store: ArtifactStore, now: () => Date = () => new Date()) {
  const pages = new Hono()
  pages.get('/:slug', async (c) => {
    const artifact = await store.findBySlug(c.req.param('slug'))
    if (!artifact || artifact.deletedAt || artifact.expiresAt <= now()) {
      return c.body(notFoundPage(), 404, SHARED_PAGE_HEADERS)
    }
    return c.body(artifact.renderedHtml, 200, SHARED_PAGE_HEADERS)
  })
  return pages
}
