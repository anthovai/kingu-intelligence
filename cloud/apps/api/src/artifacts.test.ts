import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { MemoryArtifactStore } from './artifact-store.js'
import { loadConfig } from './config.js'

const config = loadConfig({ PORT: '8787', KINGU_API_PUBLIC_URL: 'http://127.0.0.1:8787', KINGU_API_DEV_AUTH: '1', KINGU_API_STATIC_TOKENS: 'other-token=other-user' })

function setup(start = new Date('2026-09-26T00:00:00Z')) {
  let now = start
  const app = createApp(config, { artifacts: new MemoryArtifactStore() }, () => now)
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
  return { call, advance: (ms: number) => { now = new Date(now.getTime() + ms) } }
}

const markdown = { content: '# Hello\n\nA **report**.', contentType: 'text/markdown', fileName: 'report.md', title: 'Report' }

describe('artifacts API', () => {
  it('creates, lists, serves and replays a create with the same edit token', async () => {
    const { call } = setup()
    const created = await call('POST', '/v1/artifacts', { body: markdown, headers: { 'idempotency-key': 'k1' } })
    const first = await created.json() as { artifact: { slug: string; renderedContentType: string; byteSize: number }; shareUrl: string; editToken: string }
    const replay = await (await call('POST', '/v1/artifacts', { body: markdown, headers: { 'idempotency-key': 'k1' } })).json() as typeof first
    const list = await (await call('GET', '/v1/artifacts')).json() as { artifacts: { artifact: { slug: string } }[] }
    const page = await call('GET', `/a/${first.artifact.slug}?embed=1`)
    const html = await page.text()

    expect({
      status: created.status,
      shareUrl: first.shareUrl === `http://127.0.0.1:8787/a/${first.artifact.slug}`,
      rendered: first.artifact.renderedContentType,
      byteSize: first.artifact.byteSize,
      replaySameSlug: replay.artifact.slug === first.artifact.slug,
      replaySameToken: replay.editToken === first.editToken,
      listed: list.artifacts.map((item) => item.artifact.slug),
      pageStatus: page.status,
      sandboxed: page.headers.get('content-security-policy')?.startsWith('sandbox allow-scripts'),
      renderedHeading: html.includes('<h1>Hello</h1>')
    }).toEqual({
      status: 201,
      shareUrl: true,
      rendered: 'text/html',
      byteSize: Buffer.byteLength(markdown.content),
      replaySameSlug: true,
      replaySameToken: true,
      listed: [first.artifact.slug],
      pageStatus: 200,
      sandboxed: true,
      renderedHeading: true
    })
  })

  it('updates only with the edit token and owner, and unshares to a dead link', async () => {
    const { call } = setup()
    const { artifact, editToken } = await (await call('POST', '/v1/artifacts', { body: markdown })).json() as { artifact: { slug: string }; editToken: string }
    const html = { content: '<p>v2</p>', contentType: 'text/html', fileName: 'v2.html' }
    const noToken = await call('PUT', `/v1/artifacts/${artifact.slug}`, { body: html })
    const otherUser = await call('PUT', `/v1/artifacts/${artifact.slug}`, { token: 'other-token', body: html, headers: { 'x-kingu-edit-token': editToken } })
    const updated = await call('PUT', `/v1/artifacts/${artifact.slug}`, { body: html, headers: { 'x-kingu-edit-token': editToken } })
    const pageAfterUpdate = await (await call('GET', `/a/${artifact.slug}`)).text()
    const unshared = await call('DELETE', `/v1/artifacts/${artifact.slug}`, { headers: { 'x-kingu-edit-token': editToken } })
    const again = await call('DELETE', `/v1/artifacts/${artifact.slug}`)
    const page = await call('GET', `/a/${artifact.slug}`)

    expect({
      noToken: [noToken.status, (await noToken.json() as { code: string }).code],
      otherUser: otherUser.status,
      updated: updated.status,
      pageAfterUpdate,
      unshared: unshared.status,
      again: [again.status, (await again.json() as { code: string }).code],
      page: page.status
    }).toEqual({
      noToken: [403, 'artifact_forbidden'],
      otherUser: 403,
      updated: 200,
      pageAfterUpdate: '<p>v2</p>',
      unshared: 204,
      again: [404, 'artifact_not_found'],
      page: 404
    })
  })

  it('refuses a missing token, invalid bodies, and serves nothing once expired', async () => {
    const { call, advance } = setup()
    const anonymous = await call('GET', '/v1/artifacts', { token: '' })
    const invalid = await call('POST', '/v1/artifacts', { body: { content: 'x', contentType: 'image/png', fileName: 'x.png' } })
    const { artifact } = await (await call('POST', '/v1/artifacts', { body: markdown })).json() as { artifact: { slug: string } }
    advance(31 * 86_400_000)
    const expired = await call('GET', `/a/${artifact.slug}`)
    const list = await (await call('GET', '/v1/artifacts')).json() as { artifacts: unknown[] }

    expect({
      anonymous: [anonymous.status, (await anonymous.json() as { code: string }).code],
      invalid: [invalid.status, (await invalid.json() as { code: string }).code],
      expired: expired.status,
      listed: list.artifacts.length
    }).toEqual({ anonymous: [401, 'invalid_access_token'], invalid: [422, 'artifact_validation_failed'], expired: 404, listed: 0 })
  })

  it('pages the list newest first with an opaque cursor', async () => {
    const { call, advance } = setup()
    const slugs: string[] = []
    for (let i = 0; i < 52; i++) {
      const { artifact } = await (await call('POST', '/v1/artifacts', { body: { ...markdown, title: `n${i}` } })).json() as { artifact: { slug: string } }
      slugs.push(artifact.slug)
      advance(1000)
    }
    const first = await (await call('GET', '/v1/artifacts')).json() as { artifacts: { artifact: { slug: string } }[]; nextCursor?: string }
    const second = await (await call('GET', `/v1/artifacts?cursor=${encodeURIComponent(first.nextCursor ?? '')}`)).json() as typeof first

    expect({
      firstCount: first.artifacts.length,
      firstNewest: first.artifacts[0]?.artifact.slug === slugs[51],
      second: second.artifacts.map((item) => item.artifact.slug),
      end: second.nextCursor
    }).toEqual({ firstCount: 50, firstNewest: true, second: [slugs[1], slugs[0]], end: undefined })
  })
})
