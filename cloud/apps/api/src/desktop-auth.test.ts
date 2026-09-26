import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MemoryAccountStore } from './account-store.js'
import { createApp } from './app.js'
import { MemoryArtifactStore } from './artifact-store.js'
import { loadConfig } from './config.js'
import { isEmailAllowed } from './desktop-auth.js'
import { MemorySkillStore } from './skill-store.js'

const config = loadConfig({ PORT: '8787', KINGU_API_PUBLIC_URL: 'http://127.0.0.1:8787', KINGU_API_ALLOWED_EMAILS: '@example.com', KINGU_API_GRANT_SECRET: 'x'.repeat(40) })

const b64 = (bytes: Buffer) => bytes.toString('base64url')

function setup(start = new Date('2026-09-26T00:00:00Z')) {
  let now = start
  const app = createApp(config, { artifacts: new MemoryArtifactStore(), skills: new MemorySkillStore(), accounts: new MemoryAccountStore() }, () => now)
  const json = (path: string, body: unknown, token?: string) => app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
  /** The desktop's `beginKinguCloudPkceFlow`, with the browser played by a form post. */
  const signIn = async (fields: Record<string, string>) => {
    const verifier = b64(randomBytes(32))
    const request = {
      client_id: 'kingu-desktop',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:53123/auth/callback',
      scope: 'openid profile email offline_access',
      nonce: b64(randomBytes(32)),
      state: b64(randomBytes(32)),
      code_challenge: b64(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      local_profile_id: 'local-1'
    }
    const pageResponse = await app.request(`/v1/desktop/auth/authorize?${new URLSearchParams(request)}`)
    const posted = await app.request('/v1/desktop/auth/authorize', { method: 'POST', body: new URLSearchParams({ ...request, action: 'continue', ...fields }) })
    const location = posted.headers.get('location')
    const callback = location ? new URL(location) : undefined
    const exchange = callback?.searchParams.get('code')
      ? await json('/v1/desktop/auth/session', { code: callback.searchParams.get('code'), codeVerifier: verifier, nonce: request.nonce, redirectUri: request.redirect_uri, state: request.state, localProfileId: 'local-1' })
      : undefined
    return { request, verifier, pageStatus: pageResponse.status, posted, callback, exchange }
  }
  return { app, json, signIn, advance: (ms: number) => { now = new Date(now.getTime() + ms) } }
}

type Session = { accessToken: string; refreshToken: string; expiresAt: number; cloud: { userId: string; cloudProfileId: string; email: string; activeOrgId: string }; organizations: { orgId: string }[]; capabilities: { flags: Record<string, boolean> } }

describe('desktop sign-in', () => {
  it('creates an account, redirects to the loopback callback and exchanges the code once', async () => {
    const { signIn, json } = setup()
    const flow = await signIn({ mode: 'signup', email: 'Me@Example.com', password: 'a-long-password', name: 'Me' })
    const session = await flow.exchange!.json() as Session
    const codeAgain = await json('/v1/desktop/auth/session', { code: flow.callback!.searchParams.get('code'), codeVerifier: flow.verifier, nonce: flow.request.nonce, redirectUri: flow.request.redirect_uri })
    const artifact = await json('/v1/artifacts', { content: '# Hi', contentType: 'text/markdown', fileName: 'hi.md' }, session.accessToken)
    const capabilities = await (await json('/v1/desktop/auth/capabilities', {}, session.accessToken)).json() as { cloud: { userId: string } }

    expect({
      page: flow.pageStatus,
      redirect: [flow.posted.status, flow.callback?.origin + flow.callback!.pathname, flow.callback?.searchParams.get('state') === flow.request.state],
      exchange: flow.exchange!.status,
      session: { email: session.cloud.email, org: session.cloud.activeOrgId === session.organizations[0]?.orgId, share: session.capabilities.flags['share.create'], expiresInAnHour: session.expiresAt === Date.parse('2026-09-26T01:00:00Z') },
      codeAgain: codeAgain.status,
      artifact: artifact.status,
      capabilitiesSameUser: capabilities.cloud.userId === session.cloud.userId
    }).toEqual({
      page: 200,
      redirect: [302, 'http://127.0.0.1:53123/auth/callback', true],
      exchange: 200,
      session: { email: 'me@example.com', org: true, share: true, expiresInAnHour: true },
      codeAgain: 400,
      artifact: 201,
      capabilitiesSameUser: true
    })
  })

  it('signs in again, refuses wrong passwords, other emails and a wrong verifier', async () => {
    const { signIn, json } = setup()
    await signIn({ mode: 'signup', email: 'me@example.com', password: 'a-long-password' })
    const again = await signIn({ mode: 'signin', email: 'me@example.com', password: 'a-long-password' })
    const wrong = await signIn({ mode: 'signin', email: 'me@example.com', password: 'nope' })
    const outsider = await signIn({ mode: 'signup', email: 'someone@elsewhere.org', password: 'a-long-password' })
    const stolen = await signIn({ mode: 'signin', email: 'me@example.com', password: 'a-long-password' })
    const badVerifier = await json('/v1/desktop/auth/session', { code: stolen.callback!.searchParams.get('code'), codeVerifier: b64(randomBytes(32)), nonce: stolen.request.nonce, redirectUri: stolen.request.redirect_uri })
    const cancelled = await setup().app.request('/v1/desktop/auth/authorize', { method: 'POST', body: new URLSearchParams({ ...again.request, action: 'cancel' }) })
    const badRedirect = await setup().app.request(`/v1/desktop/auth/authorize?${new URLSearchParams({ ...again.request, redirect_uri: 'https://evil.example/auth/callback' })}`)

    expect({
      again: again.exchange?.status,
      wrong: [wrong.posted.status, wrong.callback],
      outsider: outsider.posted.status,
      badVerifier: badVerifier.status,
      cancelled: new URL(cancelled.headers.get('location')!).searchParams.get('error'),
      badRedirect: [badRedirect.status, badRedirect.headers.get('location')]
    }).toEqual({
      again: 200,
      wrong: [401, undefined],
      outsider: 403,
      badVerifier: 400,
      cancelled: 'access_denied',
      badRedirect: [400, null]
    })
  })

  it('rotates on refresh, forgives a quick retry, revokes on replay and on logout', async () => {
    const { signIn, json, advance } = setup()
    const first = await (await (await signIn({ mode: 'signup', email: 'me@example.com', password: 'a-long-password' })).exchange!).json() as Session
    const second = await (await json('/v1/desktop/auth/refresh', { refreshToken: first.refreshToken })).json() as Session
    const retry = await json('/v1/desktop/auth/refresh', { refreshToken: first.refreshToken })
    const retried = await retry.json() as Session
    const oldAccess = await json('/v1/desktop/auth/capabilities', {}, first.accessToken)
    advance(3 * 60_000)
    const replay = await json('/v1/desktop/auth/refresh', { refreshToken: first.refreshToken })
    const afterReplay = await json('/v1/desktop/auth/refresh', { refreshToken: retried.refreshToken })

    const other = await (await (await signIn({ mode: 'signin', email: 'me@example.com', password: 'a-long-password' })).exchange!).json() as Session
    const logout = await json('/v1/desktop/auth/logout', { refreshToken: other.refreshToken }, other.accessToken)
    const afterLogout = await json('/v1/desktop/auth/refresh', { refreshToken: other.refreshToken })

    expect({
      rotated: second.refreshToken !== first.refreshToken && second.accessToken !== first.accessToken,
      sameIdentity: second.cloud.cloudProfileId === first.cloud.cloudProfileId && second.cloud.activeOrgId === first.cloud.activeOrgId,
      retry: retry.status,
      oldAccess: oldAccess.status,
      replay: replay.status,
      afterReplay: afterReplay.status,
      logout: logout.status,
      afterLogout: afterLogout.status,
      allowed: [isEmailAllowed(['*'], 'a@b.c'), isEmailAllowed(['@example.com'], 'a@example.com'), isEmailAllowed(['a@example.com'], 'b@example.com'), isEmailAllowed([], 'a@b.c')]
    }).toEqual({
      rotated: true,
      sameIdentity: true,
      retry: 200,
      oldAccess: 401,
      replay: 401,
      afterReplay: 401,
      logout: 200,
      afterLogout: 401,
      allowed: [true, true, false, false]
    })
  })
})
