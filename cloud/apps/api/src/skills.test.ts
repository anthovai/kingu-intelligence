import { createHash, randomUUID } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { MemoryArtifactStore } from './artifact-store.js'
import { loadConfig } from './config.js'
import { MemorySkillStore } from './skill-store.js'

const config = loadConfig({ PORT: '8787', KINGU_API_PUBLIC_URL: 'http://127.0.0.1:8787', KINGU_API_DEV_AUTH: '1', KINGU_API_STATIC_TOKENS: 'other-token=other-user', KINGU_API_GRANT_SECRET: 'x'.repeat(40) })

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** A ustar entry the way the desktop's `writeSkillTarGzip` writes one. */
function tarEntry(path: string, bytes: Buffer): Buffer {
  const header = Buffer.alloc(512)
  header.write(path, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)])
}

function bundle(packageId = randomUUID()) {
  const skillMd = Buffer.from('---\nname: hello\ndescription: Says hello\n---\n# Hello\n')
  const file = { path: 'SKILL.md', size: skillMd.length, executable: false, classification: 'text' as const, sha256: sha256(skillMd), identitySha256: sha256(skillMd) }
  const digest = sha256(JSON.stringify([{ path: file.path, executable: file.executable, classification: file.classification, identitySha256: file.identitySha256 }]))
  const skills = [{ id: 'hello', name: 'hello', description: 'Says hello', digest, files: [file] }]
  const manifest = {
    schemaVersion: 1,
    packageId,
    versionId: randomUUID(),
    bundleName: 'my-skills',
    description: 'Team skills',
    createdAt: '2026-09-26T00:00:00.000Z',
    skills,
    bundleDigest: sha256(JSON.stringify(skills.map(({ id, name, digest: skillDigest }) => ({ id, name, digest: skillDigest }))))
  }
  const archive = gzipSync(Buffer.concat([
    tarEntry('plugin.json', Buffer.from(JSON.stringify({ name: 'my-skills', version: manifest.versionId, description: 'Team skills' }))),
    tarEntry('dev.kingu.skill-sharing/manifest.json', Buffer.from(JSON.stringify(manifest))),
    tarEntry('skills/hello/SKILL.md', skillMd),
    Buffer.alloc(1024)
  ]))
  return { manifest, archive, archiveSha256: sha256(archive) }
}

function setup(start = new Date('2026-09-26T00:00:00Z')) {
  let now = start
  const app = createApp(config, { artifacts: new MemoryArtifactStore(), skills: new MemorySkillStore() }, () => now)
  const call = (method: string, path: string, init: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(init.token === '' ? {} : { authorization: `Bearer ${init.token ?? 'dev-access-1'}` }),
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers
      },
      body: init.body ? JSON.stringify(init.body) : undefined
    })
  const local = (url: string) => url.replace(config.publicUrl, '')
  /** #1 → #2 → #3 → #4, as the desktop's `publish()` does. */
  const publish = async (item: ReturnType<typeof bundle>, key = randomUUID(), token?: string) => {
    const reserved = await (await call('POST', '/v1/skill-packages/uploads', { token, body: { expectedArchiveSha256: item.archiveSha256, expectedCompressedBytes: item.archive.length }, headers: { 'idempotency-key': key } })).json() as { upload: { id: string; policy: { url: string; fields: Record<string, string> } } }
    const form = new FormData()
    for (const [name, value] of Object.entries(reserved.upload.policy.fields)) {
      form.append(name, value)
    }
    form.append('file', new Blob([new Uint8Array(item.archive)], { type: 'application/vnd.kingu.skill+tar+gzip' }), 'package.tar.gz')
    const uploaded = await app.request(local(reserved.upload.policy.url), { method: 'POST', body: form })
    const finalized = await call('POST', `/v1/skill-packages/uploads/${reserved.upload.id}/finalize`, { token, body: { releaseNotes: 'First' }, headers: { 'idempotency-key': reserved.upload.id } })
    const version = (await finalized
      .clone().json() as { version: { packageId: string; versionId: string; name: string; packageDigest: string } }).version
    if (!finalized.ok) {
      return { reserved, uploaded, finalized, version, share: { id: '', url: '' } }
    }
    const shared = await (await call('POST', `/v1/skill-packages/${version.packageId}/shares`, { token, body: {}, headers: { 'idempotency-key': `${key}_share` } })).json() as { share: { id: string; url: string } }
    return { reserved, uploaded, finalized, version, share: shared.share }
  }
  return { app, call, publish, local, advance: (ms: number) => { now = new Date(now.getTime() + ms) } }
}

describe('skills API', () => {
  it('publishes a bundle, resolves the link without an account and downloads the archive', async () => {
    const { call, publish, local } = setup()
    const item = bundle()
    const published = await publish(item)
    const resolved = await call('GET', `/v1/skill-shares/${published.share.id}`, { token: '' })
    const resolvedBody = await resolved.json() as { share: { version: { versionId: string } } }
    const grant = await (await call('POST', `/v1/skill-shares/${published.share.id}/download-grants`, { token: '', body: { versionId: item.manifest.versionId, installTarget: 'local' } })).json() as { grant: { url: string; expiresAt: string }; version: { versionId: string } }
    const download = await call('GET', local(grant.grant.url), { token: '' })
    const bytes = Buffer.from(await download.arrayBuffer())
    const page = await call('GET', local(published.share.url), { token: '' })

    expect({
      upload: published.uploaded.status,
      finalize: published.finalized.status,
      version: { packageId: published.version.packageId, versionId: published.version.versionId, name: published.version.name, packageDigest: published.version.packageDigest },
      shareUrl: published.share.url.startsWith('http://127.0.0.1:8787/skills/share/'),
      resolved: [resolved.status, resolvedBody.share.version.versionId],
      grantVersion: grant.version.versionId,
      grantOnThisOrigin: grant.grant.url.startsWith('http://127.0.0.1:8787/v1/skill-downloads/'),
      download: [download.status, download.headers.get('content-type'), sha256(bytes)],
      page: [page.status, (await page.text()).includes('kingu://skills/share/')]
    }).toEqual({
      upload: 204,
      finalize: 201,
      version: { packageId: item.manifest.packageId, versionId: item.manifest.versionId, name: 'my-skills', packageDigest: item.manifest.bundleDigest },
      shareUrl: true,
      resolved: [200, item.manifest.versionId],
      grantVersion: item.manifest.versionId,
      grantOnThisOrigin: true,
      download: [200, 'application/vnd.kingu.skill+tar+gzip', item.archiveSha256],
      page: [200, true]
    })
  })

  it('replays retries, lists and revokes shares, and refuses another account', async () => {
    const { call, publish, advance, local } = setup()
    const item = bundle()
    const key = randomUUID()
    const published = await publish(item, key)
    const replayUpload = await call('POST', '/v1/skill-packages/uploads', { body: { expectedArchiveSha256: item.archiveSha256, expectedCompressedBytes: item.archive.length }, headers: { 'idempotency-key': key } })
    const replayFinalize = await call('POST', `/v1/skill-packages/uploads/${published.reserved.upload.id}/finalize`, { body: { releaseNotes: 'First' } })
    const details = await (await call('GET', `/v1/skill-packages/${item.manifest.packageId}`)).json() as { package: { canManage: boolean; versions: { versionId: string }[]; management?: { shares: { id: string }[] } } }
    const owned = await (await call('GET', '/v1/skill-shares')).json() as { shares: { id: string; name: string }[] }
    const otherView = await call('DELETE', `/v1/skill-shares/${published.share.id}`, { token: 'other-token' })
    const otherPublish = await publish(bundle(item.manifest.packageId), randomUUID(), 'other-token').catch(() => undefined)
    const grant = await (await call('POST', `/v1/skill-shares/${published.share.id}/download-grants`, { token: '', body: {} })).json() as { grant: { url: string } }
    advance(16 * 60_000)
    const expired = await call('GET', local(grant.grant.url), { token: '' })
    const revoked = await call('DELETE', `/v1/skill-shares/${published.share.id}`)
    const afterRevoke = await call('GET', `/v1/skill-shares/${published.share.id}`, { token: '' })
    const deleted = await call('DELETE', `/v1/skill-packages/${item.manifest.packageId}`)

    expect({
      replayUpload: [replayUpload.status, (await replayUpload.json() as { code: string }).code],
      replayFinalize: [replayFinalize.status, (await replayFinalize.json() as { version: { versionId: string } }).version.versionId],
      details: { canManage: details.package.canManage, versions: details.package.versions.map((v) => v.versionId), shares: details.package.management?.shares.map((s) => s.id) },
      owned: owned.shares.map((s) => [s.id, s.name]),
      otherRevoke: otherView.status,
      // The desktop's #3 would fail here; `publish` then sees no version.
      otherPublishSameId: otherPublish?.finalized.status,
      expired: expired.status,
      revoked: revoked.status,
      afterRevoke: afterRevoke.status,
      deleted: deleted.status
    }).toEqual({
      replayUpload: [409, 'skill_upload_not_pending'],
      replayFinalize: [200, item.manifest.versionId],
      details: { canManage: true, versions: [item.manifest.versionId], shares: [published.share.id] },
      owned: [[published.share.id, 'my-skills']],
      otherRevoke: 404,
      otherPublishSameId: 409,
      expired: 410,
      revoked: 204,
      afterRevoke: 404,
      deleted: 204
    })
  })

  it('rejects an upload that does not match its reservation', async () => {
    const { call, local, app } = setup()
    const item = bundle()
    const reserved = await (await call('POST', '/v1/skill-packages/uploads', { body: { expectedArchiveSha256: item.archiveSha256, expectedCompressedBytes: item.archive.length } })).json() as { upload: { id: string; policy: { url: string; fields: { token: string } } } }
    const send = (token: string, bytes: Buffer) => {
      const form = new FormData()
      form.append('token', token)
      form.append('file', new Blob([new Uint8Array(bytes)]), 'package.tar.gz')
      return app.request(local(reserved.upload.policy.url), { method: 'POST', body: form })
    }
    const badToken = await send('wrong', item.archive)
    const badBytes = await send(reserved.upload.policy.fields.token, Buffer.concat([item.archive, Buffer.from('x')]))
    const finalizeEarly = await call('POST', `/v1/skill-packages/uploads/${reserved.upload.id}/finalize`, { body: {} })
    expect([badToken.status, badBytes.status, finalizeEarly.status]).toEqual([403, 422, 409])
  })
})
