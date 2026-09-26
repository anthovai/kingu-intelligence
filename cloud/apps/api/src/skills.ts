import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { resolveCaller, type Caller } from './auth.js'
import type { ApiConfig } from './config.js'
import { readSkillArchive, SKILL_PACKAGE_CONTENT_TYPE, SKILL_PACKAGE_MAX_COMPRESSED_BYTES, SkillArchiveError } from './skill-archive.js'
import type { SkillStore, StoredSkillPackage, StoredSkillShare, StoredSkillVersion } from './skill-store.js'
import { escapeHtml } from './render.js'

/**
 * The desktop's skill-sharing contract (`src/main/skills/skill-cloud-service.ts`,
 * `src/shared/skill-cloud-contract.ts`):
 *
 * - publish: reserve an upload, POST the archive as multipart to the policy
 *   URL, finalize it into a version (read from the archive's own manifest),
 *   then create an unlisted share;
 * - install: resolve a share and ask for a download grant, both without an
 *   account — the link is the credential — or, as the owner, a grant for any
 *   version;
 * - manage: the package with its versions and shares, the owner's shares,
 *   revoke, and delete a version or the whole package.
 *
 * Download grants are short-lived HMAC-signed URLs on this same origin, so
 * the desktop's download allow-list only has to name this origin.
 */

const ID = /^[A-Za-z0-9_-]{1,128}$/
const SHA256 = /^[a-f0-9]{64}$/
const UPLOAD_TTL_MS = 30 * 60_000
const GRANT_TTL_MS = 15 * 60_000

type Variables = { caller: Caller }

const uploadBodySchema = z.object({
  expectedArchiveSha256: z.string().regex(SHA256),
  expectedCompressedBytes: z.number().int().positive().max(SKILL_PACKAGE_MAX_COMPRESSED_BYTES)
})
const finalizeBodySchema = z.object({ releaseNotes: z.string().max(10_000).default('') })
const shareBodySchema = z.object({ pinnedVersionId: z.string().regex(ID).optional() })
const installTargetSchema = z.enum(['local', 'remote']).optional()
const shareGrantBodySchema = z.object({ versionId: z.string().regex(ID).optional(), installTarget: installTargetSchema })
const versionGrantBodySchema = z.object({ installTarget: installTargetSchema })

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422

function error(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json({ code, message }, status)
}

async function readJson<T>(c: Context, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<{ data: T } | { response: Response }> {
  const text = await c.req.text()
  const parsed = schema.safeParse(text ? JSON.parse(text) : {})
  return parsed.success ? { data: parsed.data } : { response: error(c, 422, 'skill_validation_failed', parsed.error.issues[0]?.message ?? 'Invalid request.') }
}

function shareId(): string {
  return randomBytes(16).toString('base64url')
}

/** `SkillCloudVersion`. */
function toVersion(version: StoredSkillVersion) {
  return {
    packageId: version.packageId,
    versionId: version.versionId,
    name: version.name,
    description: version.description,
    packageDigest: version.packageDigest,
    archiveSha256: version.archiveSha256,
    compressedBytes: version.compressedBytes,
    createdAt: version.createdAt.toISOString(),
    releaseNotes: version.releaseNotes,
    manifest: version.manifest
  }
}

export function skillShareUrl(config: ApiConfig, id: string): string {
  return `${config.publicUrl}/skills/share/${id}`
}

/** Signs `packageId/versionId/expiry`; the download route checks it without a lookup of its own. */
function grantSignature(config: ApiConfig, payload: string): string {
  return createHmac('sha256', config.grantSecret).update(payload).digest('base64url')
}

function createGrant(config: ApiConfig, version: StoredSkillVersion, now: Date) {
  const expiresAt = new Date(now.getTime() + GRANT_TTL_MS)
  const payload = `${version.packageId}.${version.versionId}.${expiresAt.getTime()}`
  return {
    grant: { url: `${config.publicUrl}/v1/skill-downloads/${payload}.${grantSignature(config, payload)}`, expiresAt: expiresAt.toISOString() },
    version: toVersion(version)
  }
}

function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function skillRoutes(config: ApiConfig, store: SkillStore, now: () => Date = () => new Date()) {
  const api = new Hono<{ Variables: Variables }>()

  const requireCaller = async (c: Context<{ Variables: Variables }>, next: () => Promise<void>) => {
    const caller = resolveCaller(config, c.req.header('authorization'))
    if (!caller) {
      return error(c, 401, 'invalid_access_token', 'Sign in to Kingu cloud again.')
    }
    c.set('caller', caller)
    await next()
  }

  const livePackage = async (id: string): Promise<StoredSkillPackage | undefined> => {
    const found = ID.test(id) ? await store.findPackage(id) : undefined
    return found && !found.deletedAt ? found : undefined
  }

  const liveShare = async (id: string): Promise<StoredSkillShare | undefined> => {
    const found = ID.test(id) ? await store.findShare(id) : undefined
    if (!found || found.revokedAt || !(await livePackage(found.packageId))) {
      return undefined
    }
    return found
  }

  /** What a share installs: its pinned version, else the newest. */
  const shareVersion = async (share: StoredSkillShare): Promise<StoredSkillVersion | undefined> => {
    if (share.pinnedVersionId) {
      const pinned = await store.findVersion(share.packageId, share.pinnedVersionId)
      return pinned && !pinned.deletedAt ? pinned : undefined
    }
    return (await store.listVersions(share.packageId))[0]
  }

  // --- Publish --------------------------------------------------------------

  api.post('/skill-packages/uploads', requireCaller, async (c) => {
    const caller = c.get('caller')
    const idempotencyKey = c.req.header('idempotency-key') ?? null
    const body = await readJson(c, uploadBodySchema)
    if ('response' in body) {
      return body.response
    }
    if (idempotencyKey) {
      const existing = await store.findUploadByIdempotencyKey(caller.userId, idempotencyKey)
      if (existing) {
        if (existing.versionId) {
          return error(c, 409, 'skill_upload_not_pending', 'Upload is already finalized.')
        }
        if (existing.expectedArchiveSha256 !== body.data.expectedArchiveSha256 || existing.expectedCompressedBytes !== body.data.expectedCompressedBytes) {
          return error(c, 409, 'skill_idempotency_conflict', 'This retry does not match the original upload.')
        }
        return c.json(uploadResponse(existing.id, existing.uploadToken, existing.expiresAt))
      }
    }
    const at = now()
    const upload = {
      id: randomUUID(),
      ownerId: caller.userId,
      idempotencyKey,
      expectedArchiveSha256: body.data.expectedArchiveSha256,
      expectedCompressedBytes: body.data.expectedCompressedBytes,
      uploadToken: randomBytes(24).toString('base64url'),
      archive: null,
      packageId: null,
      versionId: null,
      createdAt: at,
      expiresAt: new Date(at.getTime() + UPLOAD_TTL_MS)
    }
    await store.insertUpload(upload)
    return c.json(uploadResponse(upload.id, upload.uploadToken, upload.expiresAt), 201)
  })

  function uploadResponse(id: string, token: string, expiresAt: Date) {
    return { upload: { id, policy: { url: `${config.publicUrl}/v1/skill-uploads/${id}`, fields: { token }, expiresAt: expiresAt.toISOString() } } }
  }

  // The policy URL: an unauthenticated multipart POST, trusted by the token the reservation handed out.
  api.post('/skill-uploads/:uploadId', async (c) => {
    const upload = await store.findUpload((c.req.param('uploadId') ?? ''))
    if (!upload || upload.versionId || upload.expiresAt <= now()) {
      return error(c, 404, 'skill_upload_not_found', 'This upload is missing, finished or expired.')
    }
    if (Number(c.req.header('content-length') ?? 0) > SKILL_PACKAGE_MAX_COMPRESSED_BYTES + 64 * 1024) {
      return error(c, 413, 'skill_package_too_large', 'The skill package is larger than 40 MiB.')
    }
    const form = await c.req.parseBody().catch(() => undefined)
    const token = form?.token
    const file = form?.file
    if (typeof token !== 'string' || !sameSignature(token, upload.uploadToken)) {
      return error(c, 403, 'skill_upload_forbidden', 'The upload token is not valid.')
    }
    if (!(file instanceof File)) {
      return error(c, 422, 'skill_upload_file_missing', 'The upload has no file part.')
    }
    const archive = Buffer.from(await file.arrayBuffer())
    if (archive.length !== upload.expectedCompressedBytes || createHash('sha256').update(archive).digest('hex') !== upload.expectedArchiveSha256) {
      return error(c, 422, 'skill_upload_mismatch', 'The uploaded file does not match the size and hash reserved for it.')
    }
    await store.updateUpload({ ...upload, archive })
    return c.body(null, 204)
  })

  api.post('/skill-packages/uploads/:uploadId/finalize', requireCaller, async (c) => {
    const caller = c.get('caller')
    const upload = await store.findUpload((c.req.param('uploadId') ?? ''))
    if (!upload || upload.ownerId !== caller.userId) {
      return error(c, 404, 'skill_upload_not_found', 'This upload does not exist.')
    }
    if (upload.packageId && upload.versionId) {
      // A retried finalize returns the version it already became.
      const version = await store.findVersion(upload.packageId, upload.versionId)
      return version ? c.json({ version: toVersion(version) }) : error(c, 410, 'skill_version_deleted', 'This version was deleted.')
    }
    if (!upload.archive) {
      return error(c, 409, 'skill_upload_incomplete', 'The package has not been uploaded yet.')
    }
    const body = await readJson(c, finalizeBodySchema)
    if ('response' in body) {
      return body.response
    }
    let identity
    try {
      identity = readSkillArchive(upload.archive)
    } catch (caught) {
      if (caught instanceof SkillArchiveError) {
        return error(c, 422, caught.code, caught.message)
      }
      throw caught
    }
    const existingPackage = await store.findPackage(identity.packageId)
    if (existingPackage && (existingPackage.ownerId !== caller.userId || existingPackage.deletedAt)) {
      return error(c, 409, 'skill_package_unavailable', 'This package id belongs to another account or was deleted.')
    }
    if (await store.findVersion(identity.packageId, identity.versionId)) {
      return error(c, 409, 'skill_version_exists', 'This version was already published.')
    }
    const at = now()
    await store.upsertPackage({
      id: identity.packageId,
      ownerId: caller.userId,
      name: identity.name,
      description: identity.description,
      createdAt: existingPackage?.createdAt ?? at,
      deletedAt: null
    })
    const version: StoredSkillVersion = {
      packageId: identity.packageId,
      versionId: identity.versionId,
      name: identity.name,
      description: identity.description,
      packageDigest: identity.packageDigest,
      archiveSha256: upload.expectedArchiveSha256,
      compressedBytes: upload.expectedCompressedBytes,
      releaseNotes: body.data.releaseNotes,
      manifest: identity.manifest,
      createdAt: at,
      deletedAt: null
    }
    await store.insertVersion(version, upload.archive)
    await store.updateUpload({ ...upload, archive: null, packageId: version.packageId, versionId: version.versionId })
    return c.json({ version: toVersion(version) }, 201)
  })

  api.post('/skill-packages/:packageId/shares', requireCaller, async (c) => {
    const caller = c.get('caller')
    const skillPackage = await livePackage((c.req.param('packageId') ?? ''))
    if (!skillPackage || skillPackage.ownerId !== caller.userId) {
      return error(c, 404, 'skill_package_not_found', 'This package does not exist.')
    }
    const body = await readJson(c, shareBodySchema)
    if ('response' in body) {
      return body.response
    }
    const idempotencyKey = c.req.header('idempotency-key') ?? null
    if (idempotencyKey) {
      const existing = await store.findShareByIdempotencyKey(caller.userId, idempotencyKey)
      if (existing) {
        return c.json({ share: { id: existing.id, url: skillShareUrl(config, existing.id) } })
      }
    }
    if (body.data.pinnedVersionId) {
      const pinned = await store.findVersion(skillPackage.id, body.data.pinnedVersionId)
      if (!pinned || pinned.deletedAt) {
        return error(c, 404, 'skill_version_not_found', 'This version does not exist.')
      }
    }
    const share: StoredSkillShare = {
      id: shareId(),
      packageId: skillPackage.id,
      ownerId: caller.userId,
      pinnedVersionId: body.data.pinnedVersionId ?? null,
      idempotencyKey,
      createdAt: now(),
      revokedAt: null
    }
    await store.insertShare(share)
    return c.json({ share: { id: share.id, url: skillShareUrl(config, share.id) } }, 201)
  })

  // --- Install ------------------------------------------------------------

  api.get('/skill-shares/:shareId', async (c) => {
    const share = await liveShare((c.req.param('shareId') ?? ''))
    const version = share && await shareVersion(share)
    if (!share || !version) {
      return error(c, 404, 'skill_share_not_found', 'This share is unavailable. The link may be invalid, expired, or revoked.')
    }
    return c.json({ share: { id: share.id, version: toVersion(version) } })
  })

  api.post('/skill-shares/:shareId/download-grants', async (c) => {
    const share = await liveShare((c.req.param('shareId') ?? ''))
    if (!share) {
      return error(c, 404, 'skill_share_not_found', 'This share is unavailable. The link may be invalid, expired, or revoked.')
    }
    const body = await readJson(c, shareGrantBodySchema)
    if ('response' in body) {
      return body.response
    }
    const requested = body.data.versionId
    if (share.pinnedVersionId && requested && requested !== share.pinnedVersionId) {
      return error(c, 403, 'skill_version_not_shared', 'This link shares a different version.')
    }
    const version = requested ? await store.findVersion(share.packageId, requested) : await shareVersion(share)
    if (!version || version.deletedAt) {
      return error(c, 404, 'skill_version_not_found', 'This version is no longer available.')
    }
    return c.json(createGrant(config, version, now()))
  })

  api.post('/skill-packages/:packageId/versions/:versionId/download-grants', requireCaller, async (c) => {
    const caller = c.get('caller')
    const skillPackage = await livePackage((c.req.param('packageId') ?? ''))
    // The owner, or anyone the package is still shared with (a managed install updating itself).
    const allowed = skillPackage && (skillPackage.ownerId === caller.userId || (await store.listShares({ packageId: skillPackage.id })).length > 0)
    const version = allowed ? await store.findVersion(skillPackage.id, (c.req.param('versionId') ?? '')) : undefined
    if (!version || version.deletedAt) {
      return error(c, 404, 'skill_version_not_found', 'This version is not available.')
    }
    const body = await readJson(c, versionGrantBodySchema)
    if ('response' in body) {
      return body.response
    }
    return c.json(createGrant(config, version, now()))
  })

  api.get('/skill-downloads/:grant', async (c) => {
    const [packageId, versionId, expiry, signature] = (c.req.param('grant') ?? '').split('.')
    const payload = `${packageId}.${versionId}.${expiry}`
    if (!packageId || !versionId || !expiry || !signature || !sameSignature(signature, grantSignature(config, payload))) {
      return error(c, 403, 'skill_grant_invalid', 'This download link is not valid.')
    }
    if (Number(expiry) <= now().getTime()) {
      return error(c, 410, 'skill_grant_expired', 'This download link has expired.')
    }
    const version = await store.findVersion(packageId, versionId)
    const archive = version && !version.deletedAt ? await store.readArchive(packageId, versionId) : undefined
    if (!archive) {
      return error(c, 404, 'skill_version_not_found', 'This version is no longer available.')
    }
    return c.body(new Uint8Array(archive), 200, {
      'content-type': SKILL_PACKAGE_CONTENT_TYPE,
      'content-length': String(archive.length),
      'cache-control': 'private, no-store'
    })
  })

  // --- Manage -------------------------------------------------------------

  api.get('/skill-packages/:packageId', requireCaller, async (c) => {
    const caller = c.get('caller')
    const skillPackage = await livePackage((c.req.param('packageId') ?? ''))
    if (!skillPackage) {
      return error(c, 404, 'skill_package_not_found', 'This package does not exist.')
    }
    const canManage = skillPackage.ownerId === caller.userId
    const shares = await store.listShares({ packageId: skillPackage.id })
    if (!canManage && shares.length === 0) {
      return error(c, 404, 'skill_package_not_found', 'This package does not exist.')
    }
    const versions = await store.listVersions(skillPackage.id)
    return c.json({
      package: {
        id: skillPackage.id,
        name: skillPackage.name,
        description: skillPackage.description,
        createdAt: skillPackage.createdAt.toISOString(),
        canManage,
        versions: versions.map(toVersion),
        ...(canManage ? {
          management: {
            shares: shares.map((share) => ({
              id: share.id,
              url: skillShareUrl(config, share.id),
              ...(share.pinnedVersionId ? { pinnedVersionId: share.pinnedVersionId } : {}),
              createdAt: share.createdAt.toISOString()
            }))
          }
        } : {})
      }
    })
  })

  api.get('/skill-shares', requireCaller, async (c) => {
    const shares = await store.listShares({ ownerId: c.get('caller').userId })
    const owned = []
    for (const share of shares) {
      const skillPackage = await livePackage(share.packageId)
      if (skillPackage) {
        owned.push({
          id: share.id,
          url: skillShareUrl(config, share.id),
          packageId: skillPackage.id,
          name: skillPackage.name,
          description: skillPackage.description,
          createdAt: share.createdAt.toISOString()
        })
      }
    }
    return c.json({ shares: owned })
  })

  api.delete('/skill-shares/:shareId', requireCaller, async (c) => {
    const share = await liveShare((c.req.param('shareId') ?? ''))
    if (!share || share.ownerId !== c.get('caller').userId) {
      return error(c, 404, 'skill_share_not_found', 'This share does not exist.')
    }
    await store.updateShare({ ...share, revokedAt: now() })
    return c.body(null, 204)
  })

  api.delete('/skill-packages/:packageId/versions/:versionId', requireCaller, async (c) => {
    const skillPackage = await livePackage((c.req.param('packageId') ?? ''))
    const version = skillPackage && skillPackage.ownerId === c.get('caller').userId ? await store.findVersion(skillPackage.id, (c.req.param('versionId') ?? '')) : undefined
    if (!version || version.deletedAt) {
      return error(c, 404, 'skill_version_not_found', 'This version does not exist.')
    }
    await store.updateVersion({ ...version, deletedAt: now() })
    return c.body(null, 204)
  })

  api.delete('/skill-packages/:packageId', requireCaller, async (c) => {
    const skillPackage = await livePackage((c.req.param('packageId') ?? ''))
    if (!skillPackage || skillPackage.ownerId !== c.get('caller').userId) {
      return error(c, 404, 'skill_package_not_found', 'This package does not exist.')
    }
    const at = now()
    for (const share of await store.listShares({ packageId: skillPackage.id })) {
      await store.updateShare({ ...share, revokedAt: at })
    }
    await store.upsertPackage({ ...skillPackage, deletedAt: at })
    return c.body(null, 204)
  })

  return api
}

/**
 * `GET /skills/share/<id>`: the link a person is sent. Kingu opens it from
 * the address bar or a `kingu://` link; anyone else sees what it holds and
 * how to install it.
 */
export function skillSharePageRoutes(store: SkillStore) {
  const pages = new Hono()
  pages.get('/:shareId', async (c) => {
    const id = (c.req.param('shareId') ?? '')
    const share = ID.test(id) ? await store.findShare(id) : undefined
    const skillPackage = share && !share.revokedAt ? await store.findPackage(share.packageId) : undefined
    const version = skillPackage && !skillPackage.deletedAt
      ? (share!.pinnedVersionId ? await store.findVersion(skillPackage.id, share!.pinnedVersionId) : (await store.listVersions(skillPackage.id))[0])
      : undefined
    if (!version || version.deletedAt) {
      return c.body(sharePage('Skill link unavailable', '<p>This link may be invalid, expired, or revoked.</p>'), 404, SKILL_SHARE_PAGE_HEADERS)
    }
    const manifest = version.manifest as { skills?: { name: string; description: string }[] }
    const skills = manifest.skills ?? [{ name: version.name, description: version.description }]
    const list = skills.map((skill) => `<li><strong>${escapeHtml(skill.name)}</strong>${skill.description ? ` — ${escapeHtml(skill.description)}` : ''}</li>`).join('')
    return c.body(sharePage(version.name, `
      ${version.description ? `<p>${escapeHtml(version.description)}</p>` : ''}
      <ul>${list}</ul>
      <p><a class="open" href="kingu://skills/share/${id}">Open in Kingu</a></p>
      <p class="hint">Or paste this page's address into Kingu → Skills → Install from Link.</p>`), 200, SKILL_SHARE_PAGE_HEADERS)
  })
  return pages
}

/** Our own page, not a user's: no scripts at all, and not sandboxed, so the `kingu://` link can open the app. */
const SKILL_SHARE_PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
}

function sharePage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#1f2328;background:#fff}
@media (prefers-color-scheme: dark){body{color:#e6edf3;background:#0d1117}}
a.open{display:inline-block;padding:8px 14px;border-radius:6px;background:#2f81f7;color:#fff;text-decoration:none}.hint{opacity:.7;font-size:13px}</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}</body></html>`
}
