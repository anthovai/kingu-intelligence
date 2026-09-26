import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { AccountStore, StoredAuthSession, StoredUser } from './account-store.js'
import { bearerToken, hashToken } from './auth.js'
import type { ApiConfig } from './config.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { escapeHtml } from './render.js'

/**
 * The desktop's Kingu Cloud sign-in (`src/main/kingu-profiles/profile-cloud-pkce.ts`,
 * `profile-cloud-client.ts`, `profile-cloud-session-refresh.ts`): OAuth
 * authorization code with PKCE (S256) and a loopback redirect to
 * `http://127.0.0.1:<any port>/auth/callback`.
 *
 * The browser part is our own sign-in page (email and password; create an
 * account from the same page). The desktop part answers in the ADE's
 * camelCase `SessionResponse`, with absolute `expiresAt` in milliseconds.
 * Tokens are opaque and stored hashed; every refresh rotates both, and a
 * refresh token used again outside a short grace revokes the whole sign-in.
 */

const CODE_TTL_MS = 5 * 60_000
const ACCESS_TTL_MS = 60 * 60_000
const REFRESH_TTL_MS = 30 * 86_400_000
/** A lost refresh answer is retried by the desktop; the rotated-away token still works this long. */
const REFRESH_REUSE_GRACE_MS = 2 * 60_000
const MAX_FAILED_SIGN_INS = 10
const FAILED_SIGN_IN_WINDOW_MS = 15 * 60_000

const LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1:(?<port>\d{1,5})\/auth\/callback$/
const BASE64URL = /^[A-Za-z0-9_-]+$/

const authorizeSchema = z.object({
  client_id: z.string(),
  response_type: z.literal('code'),
  redirect_uri: z.string().regex(LOOPBACK_REDIRECT),
  scope: z.string().max(512).optional(),
  nonce: z.string().min(1).max(512),
  state: z.string().min(1).max(512),
  code_challenge: z.string().min(43).max(128).regex(BASE64URL),
  code_challenge_method: z.literal('S256'),
  local_profile_id: z.string().max(128).optional()
})

type AuthorizeRequest = z.infer<typeof authorizeSchema>

const sessionBodySchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  nonce: z.string().min(1),
  redirectUri: z.string(),
  state: z.string().optional(),
  localProfileId: z.string().optional()
})

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

function newToken(prefix: string): string {
  return `${prefix}_${base64url(randomBytes(32))}`
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

/** `*` lets anyone create an account; otherwise addresses or `@domain` entries. */
export function isEmailAllowed(allowed: readonly string[], email: string): boolean {
  return allowed.some((entry) => entry === '*' || entry === email || (entry.startsWith('@') && email.endsWith(entry)))
}

type SignInPage = { request: AuthorizeRequest; error?: string; email?: string; mode: 'signin' | 'signup' }

/** The sign-in page's own headers: no scripts, and the form may only post here and redirect to the desktop. */
const PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#f6f7f9;color:#1f2328}
@media (prefers-color-scheme: dark){body{background:#0d1117;color:#e6edf3}.card{background:#161b22!important;border-color:#30363d!important}input{background:#0d1117!important;color:inherit!important;border-color:#30363d!important}}
.card{width:min(380px,calc(100vw - 32px));padding:28px;border:1px solid #d0d7de;border-radius:10px;background:#fff}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 16px;opacity:.8}
label{display:block;margin:12px 0 4px;font-size:13px;font-weight:600}
input{box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid #d0d7de;border-radius:6px;font:inherit}
.actions{display:flex;gap:8px;margin-top:20px}
button{flex:1;padding:9px 12px;border-radius:6px;border:1px solid #d0d7de;background:transparent;color:inherit;font:inherit;cursor:pointer}
button.primary{background:#2f81f7;border-color:#2f81f7;color:#fff}
.error{margin:12px 0 0;padding:8px 10px;border-radius:6px;background:rgb(248 81 73 / .12);color:#f85149;font-size:13px}
.switch{margin-top:16px;font-size:13px;text-align:center}.switch button{border:0;padding:0;color:#2f81f7;flex:none}
</style></head><body><main class="card">${body}</main></body></html>`
}

function hiddenFields(request: AuthorizeRequest): string {
  return Object.entries(request)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('')
}

function signInPage({ request, error, email, mode }: SignInPage): string {
  const signup = mode === 'signup'
  return page(signup ? 'Create a Kingu account' : 'Sign in to Kingu', `
<h1>${signup ? 'Create a Kingu account' : 'Sign in to Kingu'}</h1>
<p>${signup ? 'One account for sharing Artifacts and Skills from Kingu.' : 'Kingu on this computer is asking to use your Kingu cloud account.'}</p>
<form method="post" action="/v1/desktop/auth/authorize">
${hiddenFields(request)}
<input type="hidden" name="mode" value="${mode}">
${signup ? '<label for="name">Name</label><input id="name" name="name" autocomplete="name" maxlength="100">' : ''}
<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" value="${escapeHtml(email ?? '')}">
<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="${signup ? 10 : 1}" maxlength="200">
${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
<div class="actions"><button type="submit" name="action" value="cancel" formnovalidate>Cancel</button><button class="primary" type="submit" name="action" value="continue">${signup ? 'Create Account' : 'Sign In'}</button></div>
<div class="switch">${signup ? 'Already have an account? ' : 'New to Kingu? '}<button type="submit" name="action" value="${signup ? 'to-signin' : 'to-signup'}" formnovalidate>${signup ? 'Sign in' : 'Create an account'}</button></div>
</form>`)
}

function errorPage(message: string): string {
  return page('Kingu sign-in', `<h1>Kingu sign-in</h1><p>${escapeHtml(message)}</p><p>Close this tab and start signing in from Kingu again.</p>`)
}

function redirectTo(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value)
  }
  return url.toString()
}

export function desktopAuthRoutes(config: ApiConfig, accounts: AccountStore, now: () => Date = () => new Date()) {
  const api = new Hono()
  const failures = new Map<string, { count: number; since: number }>()

  const tooManyFailures = (key: string): boolean => {
    const entry = failures.get(key)
    if (!entry || now().getTime() - entry.since > FAILED_SIGN_IN_WINDOW_MS) {
      failures.delete(key)
      return false
    }
    return entry.count >= MAX_FAILED_SIGN_INS
  }

  const recordFailure = (key: string) => {
    const entry = failures.get(key)
    if (!entry || now().getTime() - entry.since > FAILED_SIGN_IN_WINDOW_MS) {
      failures.set(key, { count: 1, since: now().getTime() })
    } else {
      entry.count++
    }
  }

  const parseAuthorize = (values: Record<string, unknown>): AuthorizeRequest | undefined => {
    const parsed = authorizeSchema.safeParse(values)
    if (!parsed.success || parsed.data.client_id !== config.clientId) {
      return undefined
    }
    return parsed.data
  }

  const summary = (user: StoredUser, session: Pick<StoredAuthSession, 'cloudProfileId' | 'activeOrgId' | 'createdAt'>) => ({
    cloud: {
      cloudProfileId: session.cloudProfileId,
      userId: user.id,
      email: user.email,
      ...(user.displayName ? { displayName: user.displayName } : {}),
      activeOrgId: session.activeOrgId,
      activeOrgName: 'Personal',
      linkedAt: session.createdAt.getTime()
    },
    organizations: [{ orgId: user.personalOrgId, name: 'Personal', role: 'owner' }],
    capabilities: { flags: { share: true, 'share.create': true, 'share.manage': true }, refreshedAt: now().getTime() }
  })

  /** Rotates both tokens and answers with the ADE's `SessionResponse`. */
  const issue = async (user: StoredUser, session: StoredAuthSession, previousRefreshHash: string | null) => {
    const at = now()
    const accessToken = newToken('kat')
    const refreshToken = newToken('krt')
    const next: StoredAuthSession = {
      ...session,
      accessHash: hashToken(accessToken),
      accessExpiresAt: new Date(at.getTime() + ACCESS_TTL_MS),
      refreshHash: hashToken(refreshToken),
      previousRefreshHash,
      rotatedAt: at,
      refreshExpiresAt: new Date(at.getTime() + REFRESH_TTL_MS)
    }
    await accounts.updateSession(next)
    return { accessToken, refreshToken, expiresAt: next.accessExpiresAt.getTime(), ...summary(user, next) }
  }

  /** The signed-in session behind a Bearer token, with its user. */
  const bearerSession = async (c: Context) => {
    const token = bearerToken(c.req.header('authorization'))
    const session = token ? await accounts.findSessionByAccess(hashToken(token)) : undefined
    if (!session || session.revokedAt || session.accessExpiresAt <= now()) {
      return undefined
    }
    const user = await accounts.findUser(session.userId)
    return user ? { session, user } : undefined
  }

  // --- The browser: our sign-in page --------------------------------------

  api.get('/authorize', (c) => {
    const request = parseAuthorize(c.req.query())
    if (!request) {
      return c.body(errorPage('This sign-in link is not valid.'), 400, PAGE_HEADERS)
    }
    return c.body(signInPage({ request, mode: 'signin' }), 200, PAGE_HEADERS)
  })

  api.post('/authorize', async (c) => {
    const form = await c.req.parseBody()
    const fields = Object.fromEntries(Object.entries(form).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const request = parseAuthorize(fields)
    if (!request) {
      return c.body(errorPage('This sign-in link is not valid.'), 400, PAGE_HEADERS)
    }
    const action = fields.action
    const mode = fields.mode === 'signup' ? 'signup' : 'signin'
    if (action === 'cancel') {
      return c.redirect(redirectTo(request.redirect_uri, { error: 'access_denied', state: request.state }), 302)
    }
    if (action === 'to-signup' || action === 'to-signin') {
      return c.body(signInPage({ request, mode: action === 'to-signup' ? 'signup' : 'signin', email: fields.email }), 200, PAGE_HEADERS)
    }
    const email = normalizeEmail(fields.email ?? '')
    const password = fields.password ?? ''
    const again = (error: string, status: 400 | 401 | 403 | 429 = 400) => c.body(signInPage({ request, mode, email, error }), status, PAGE_HEADERS)
    if (!z.string().email().max(254).safeParse(email).success) {
      return again('Enter a valid email address.')
    }
    const limitKey = `${email}|${c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? ''}`
    if (tooManyFailures(limitKey)) {
      return again('Too many attempts. Wait a few minutes and try again.', 429)
    }

    let user: StoredUser | undefined
    if (mode === 'signup') {
      if (!isEmailAllowed(config.allowedEmails, email)) {
        return again('This email cannot create a Kingu account here. Ask the person who runs this Kingu cloud to add it.', 403)
      }
      if (password.length < 10) {
        return again('Use a password of at least 10 characters.')
      }
      if (await accounts.findUserByEmail(email)) {
        return again('An account with this email already exists. Sign in instead.')
      }
      const id = `usr_${randomUUID()}`
      user = {
        id,
        email,
        displayName: fields.name?.trim().slice(0, 100) || null,
        passwordHash: await hashPassword(password),
        cloudProfileId: `cp_${randomUUID()}`,
        personalOrgId: `org_${randomUUID()}`,
        createdAt: now()
      }
      await accounts.insertUser(user)
    } else {
      const found = await accounts.findUserByEmail(email)
      if (!found || !(await verifyPassword(password, found.passwordHash))) {
        recordFailure(limitKey)
        return again('The email or password is not right.', 401)
      }
      user = found
    }

    const code = base64url(randomBytes(32))
    await accounts.insertCode({
      codeHash: hashToken(code),
      userId: user.id,
      clientId: request.client_id,
      redirectUri: request.redirect_uri,
      codeChallenge: request.code_challenge,
      nonce: request.nonce,
      localProfileId: request.local_profile_id ?? null,
      expiresAt: new Date(now().getTime() + CODE_TTL_MS),
      usedAt: null
    })
    return c.redirect(redirectTo(request.redirect_uri, { code, state: request.state }), 302)
  })

  // --- The desktop: JSON, never a redirect --------------------------------

  api.post('/session', async (c) => {
    const body = sessionBodySchema.safeParse(await c.req.json().catch(() => undefined))
    if (!body.success) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    const code = await accounts.takeCode(hashToken(body.data.code), now())
    const challenge = base64url(createHash('sha256').update(body.data.codeVerifier, 'ascii').digest())
    if (!code || code.expiresAt <= now() || code.redirectUri !== body.data.redirectUri || code.nonce !== body.data.nonce || code.codeChallenge !== challenge) {
      return c.json({ error: 'invalid_grant' }, 400)
    }
    const user = await accounts.findUser(code.userId)
    if (!user) {
      return c.json({ error: 'invalid_grant' }, 400)
    }
    const at = now()
    const session: StoredAuthSession = {
      id: `ses_${randomUUID()}`,
      userId: user.id,
      cloudProfileId: user.cloudProfileId,
      activeOrgId: user.personalOrgId,
      accessHash: hashToken(newToken('kat')),
      accessExpiresAt: at,
      refreshHash: hashToken(newToken('krt')),
      previousRefreshHash: null,
      rotatedAt: at,
      refreshExpiresAt: at,
      createdAt: at,
      revokedAt: null
    }
    await accounts.insertSession(session)
    return c.json(await issue(user, session, null))
  })

  api.post('/refresh', async (c) => {
    const body = z.object({ refreshToken: z.string().min(1) }).safeParse(await c.req.json().catch(() => undefined))
    if (!body.success) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    const presented = hashToken(body.data.refreshToken)
    const session = await accounts.findSessionByRefresh(presented)
    if (!session || session.revokedAt || session.refreshExpiresAt <= now()) {
      return c.json({ error: 'invalid_grant' }, 401)
    }
    if (session.refreshHash !== presented) {
      // The token just rotated away: a retry of a refresh whose answer was lost, within the grace; otherwise a replay.
      if (now().getTime() - session.rotatedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
        await accounts.updateSession({ ...session, revokedAt: now() })
        return c.json({ error: 'invalid_grant' }, 401)
      }
    }
    const user = await accounts.findUser(session.userId)
    if (!user) {
      return c.json({ error: 'invalid_grant' }, 401)
    }
    return c.json(await issue(user, session, session.refreshHash === presented ? presented : session.previousRefreshHash))
  })

  api.post('/capabilities', async (c) => {
    const signedIn = await bearerSession(c)
    if (!signedIn) {
      return c.json({ error: 'invalid_token' }, 401)
    }
    return c.json(summary(signedIn.user, signedIn.session))
  })

  api.post('/org', async (c) => {
    const signedIn = await bearerSession(c)
    if (!signedIn) {
      return c.json({ error: 'invalid_token' }, 401)
    }
    const body = z.object({ orgId: z.string() }).safeParse(await c.req.json().catch(() => undefined))
    if (!body.success || body.data.orgId !== signedIn.user.personalOrgId) {
      return c.json({ error: 'org_not_found' }, 403)
    }
    return c.json(summary(signedIn.user, signedIn.session))
  })

  api.post('/logout', async (c) => {
    const signedIn = await bearerSession(c)
    if (signedIn) {
      await accounts.updateSession({ ...signedIn.session, revokedAt: now() })
    }
    return c.json({ ok: true })
  })

  // Extra cloud profiles and the mobile relay are not offered yet.
  api.post('/profile', (c) => c.json({ error: 'not_supported' }, 404))
  api.post('/relay-token', (c) => c.json({ error: 'not_supported' }, 404))

  return api
}
