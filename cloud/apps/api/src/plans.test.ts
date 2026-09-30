import { createHash, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MemoryAccountStore } from './account-store.js'
import { createApp } from './app.js'
import { MemoryArtifactStore } from './artifact-store.js'
import { loadConfig } from './config.js'
import { MemorySkillStore } from './skill-store.js'

const baseEnv = { PORT: '8787', KINGU_API_PUBLIC_URL: 'http://127.0.0.1:8787', KINGU_API_ALLOWED_EMAILS: '@example.com', KINGU_API_GRANT_SECRET: 'x'.repeat(40) }
const ADMIN = 'admin-secret-token'
const DAY = 86_400_000

const b64 = (bytes: Buffer) => bytes.toString('base64url')

type Account = { email: string; displayName: string | null; plan: { id: string; name: string; dailyTokens: number | null; features: string[] }; entitlement: { id: string; endsAt: string | null; source: string } | null }

function setup(env: Record<string, string> = { KINGU_API_ADMIN_TOKENS: `${ADMIN}=ops` }) {
  let now = new Date('2026-09-30T00:00:00Z')
  const app = createApp(loadConfig({ ...baseEnv, ...env }), { artifacts: new MemoryArtifactStore(), skills: new MemorySkillStore(), accounts: new MemoryAccountStore() }, () => now)
  const request = (method: string, path: string, body?: unknown, token?: string) => app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  /** Signs up through the desktop PKCE flow and returns the session answer. */
  const signUp = async (email: string, mode: 'signup' | 'signin' = 'signup') => {
    const verifier = b64(randomBytes(32))
    const authorize = {
      client_id: 'kingu-desktop',
      response_type: 'code',
      redirect_uri: 'http://127.0.0.1:53123/auth/callback',
      nonce: b64(randomBytes(32)),
      state: b64(randomBytes(32)),
      code_challenge: b64(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256'
    }
    const posted = await app.request('/v1/desktop/auth/authorize', { method: 'POST', body: new URLSearchParams({ ...authorize, action: 'continue', mode, email, password: 'a-long-password', name: 'Me' }) })
    const code = new URL(posted.headers.get('location')!).searchParams.get('code')
    const session = await request('POST', '/v1/desktop/auth/session', { code, codeVerifier: verifier, nonce: authorize.nonce, redirectUri: authorize.redirect_uri })
    return await session.json() as { accessToken: string; refreshToken: string; plan: { id: string }; capabilities: { flags: Record<string, boolean> } }
  }
  const account = async (token: string) => await (await request('GET', '/v1/account', undefined, token)).json() as Account
  const grant = (body: unknown, token = ADMIN) => request('POST', '/v1/admin/entitlements', body, token)
  return { app, request, signUp, account, grant, advance: (ms: number) => { now = new Date(now.getTime() + ms) } }
}

describe('plans and entitlements', () => {
  it('starts everyone on free, with sharing flags in the desktop session', async () => {
    const { signUp, account, request } = setup()
    const session = await signUp('me@example.com')
    const me = await account(session.accessToken)
    const anonymous = await request('GET', '/v1/account')
    expect({ me, sessionPlan: session.plan.id, flags: session.capabilities.flags, anonymous: anonymous.status }).toEqual({
      me: { email: 'me@example.com', displayName: 'Me', plan: { id: 'free', name: 'Free', dailyTokens: null, features: ['arkai', 'share', 'share.create', 'share.manage'] }, entitlement: null },
      sessionPlan: 'free',
      flags: { arkai: true, share: true, 'share.create': true, 'share.manage': true },
      anonymous: 401
    })
  })

  it('grants arkai_pro by email, shows it in /v1/account and capabilities, and falls back to free when it expires', async () => {
    const { signUp, account, grant, request, advance } = setup()
    const session = await signUp('me@example.com')
    const granted = await grant({ email: 'Me@Example.com', planId: 'arkai_pro', days: 30, note: 'beta' })
    const { entitlement } = await granted.json() as { entitlement: { id: string; source: string; grantedBy: string; endsAt: string } }
    const me = await account(session.accessToken)
    const capabilities = await (await request('POST', '/v1/desktop/auth/capabilities', {}, session.accessToken)).json() as { plan: { id: string; entitlement: { id: string } }; capabilities: { flags: Record<string, boolean> } }
    const refreshed = await (await request('POST', '/v1/desktop/auth/refresh', { refreshToken: session.refreshToken })).json() as { accessToken: string; plan: { id: string } }
    advance(31 * DAY)
    const afterExpiry = await signUp('me@example.com', 'signin')
    const later = await signUp('other@example.com')
    const unknown = await grant({ email: 'nobody@example.com', planId: 'arkai_pro' })
    const badPlan = await grant({ email: 'me@example.com', planId: 'gold' })

    expect({
      granted: [granted.status, entitlement.source, entitlement.grantedBy, entitlement.endsAt],
      me: [me.plan.id, me.plan.features.includes('arkai.pro'), me.entitlement],
      capabilities: [capabilities.plan.id, capabilities.plan.entitlement.id === entitlement.id, capabilities.capabilities.flags['arkai.pro'], capabilities.capabilities.flags['share.create']],
      refreshed: refreshed.plan.id,
      afterExpiry: [afterExpiry.plan.id, afterExpiry.capabilities.flags['arkai.pro'], afterExpiry.capabilities.flags.share, (await account(afterExpiry.accessToken)).plan.id],
      otherUser: later.plan.id,
      unknown: unknown.status,
      badPlan: badPlan.status
    }).toEqual({
      granted: [201, 'admin', 'ops', '2026-10-30T00:00:00.000Z'],
      me: ['arkai_pro', true, { id: entitlement.id, endsAt: '2026-10-30T00:00:00.000Z', source: 'admin' }],
      capabilities: ['arkai_pro', true, true, true],
      refreshed: 'arkai_pro',
      afterExpiry: ['free', undefined, true, 'free'],
      otherUser: 'free',
      unknown: 404,
      badPlan: 422
    })
  })

  it('revoking the entitlement puts the account back on free', async () => {
    const { signUp, account, grant, request } = setup()
    const session = await signUp('me@example.com')
    const { entitlement } = await (await grant({ email: 'me@example.com', planId: 'arkai_pro' })).json() as { entitlement: { id: string; endsAt: string | null } }
    const before = await account(session.accessToken)
    const revoked = await request('DELETE', `/v1/admin/entitlements/${entitlement.id}`, undefined, ADMIN)
    const again = await request('DELETE', `/v1/admin/entitlements/${entitlement.id}`, undefined, ADMIN)
    const after = await account(session.accessToken)
    expect({ noEnd: entitlement.endsAt, before: before.plan.id, revoked: revoked.status, again: again.status, after: [after.plan.id, after.entitlement] })
      .toEqual({ noEnd: null, before: 'arkai_pro', revoked: 200, again: 404, after: ['free', null] })
  })

  it('redeems a grant code once per account and enforces max uses', async () => {
    const { signUp, account, request } = setup()
    const minted = await request('POST', '/v1/admin/grant-codes', { planId: 'arkai_pro', days: 14, maxUses: 2 }, ADMIN)
    const { code } = await minted.json() as { code: string }
    const [a, b, c] = [await signUp('a@example.com'), await signUp('b@example.com'), await signUp('c@example.com')]
    const redeemA = await request('POST', '/v1/account/redeem', { code: ` ${code.toLowerCase()} ` }, a.accessToken)
    const redeemAAgain = await request('POST', '/v1/account/redeem', { code }, a.accessToken)
    const redeemB = await request('POST', '/v1/account/redeem', { code }, b.accessToken)
    const redeemC = await request('POST', '/v1/account/redeem', { code }, c.accessToken)
    const bogus = await request('POST', '/v1/account/redeem', { code: 'KINGU-NOPE-NOPE-NOPE-NOPE' }, c.accessToken)
    const aAccount = await redeemA.json() as Account

    expect({
      minted: [minted.status, /^KINGU-(?:[A-Z2-9]{4}-){3}[A-Z2-9]{4}$/.test(code)],
      a: [redeemA.status, aAccount.plan.id, aAccount.entitlement?.source, aAccount.entitlement?.endsAt],
      aAgain: redeemAAgain.status,
      b: [redeemB.status, (await account(b.accessToken)).plan.id],
      c: [redeemC.status, (await account(c.accessToken)).plan.id],
      bogus: bogus.status
    }).toEqual({
      minted: [201, true],
      a: [200, 'arkai_pro', 'code', '2026-10-14T00:00:00.000Z'],
      aAgain: 409,
      b: [200, 'arkai_pro'],
      c: [404, 'free'],
      bogus: 404
    })
  })

  it('admin endpoints refuse a missing or wrong admin token, a user token, and everything when none is configured', async () => {
    const { signUp, grant, request } = setup()
    const user = await signUp('me@example.com')
    const body = { email: 'me@example.com', planId: 'arkai_pro' }
    const missing = await request('POST', '/v1/admin/entitlements', body)
    const wrong = await grant(body, 'not-the-token')
    const userToken = await grant(body, user.accessToken)
    const codeWrong = await request('POST', '/v1/admin/grant-codes', { planId: 'arkai_pro', days: 1, maxUses: 1 }, 'nope')
    const revokeWrong = await request('DELETE', '/v1/admin/entitlements/ent_x', undefined, 'nope')
    const disabled = setup({})
    const off = await disabled.grant(body)
    expect([missing.status, wrong.status, userToken.status, codeWrong.status, revokeWrong.status, off.status]).toEqual([401, 401, 401, 401, 401, 403])
  })
})
