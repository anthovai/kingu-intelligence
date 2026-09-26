import { createHash } from 'node:crypto'
import type { AccountStore } from './account-store.js'
import type { ApiConfig } from './config.js'

/** Who a request is from; artifacts and skills are owned by `userId`. */
export type Caller = { readonly userId: string }

/** Resolves an `authorization` header to its owner, or `undefined` when it names no one. */
export type Authenticate = (authorization: string | undefined) => Promise<Caller | undefined>

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function bearerToken(authorization: string | undefined): string | undefined {
  return /^Bearer\s+(?<token>\S+)$/i.exec(authorization ?? '')?.groups?.token
}

/**
 * The bearer tokens this API accepts: an access token from desktop sign-in
 * (`desktop-auth.ts`), a static token from the environment (scripts), and —
 * only with `KINGU_API_DEV_AUTH=1`, never in production — the desktop's
 * dev-build `dev-access-<uuid>` tokens as one dev user.
 */
export function createAuthenticator(config: ApiConfig, accounts: AccountStore, now: () => Date = () => new Date()): Authenticate {
  return async (authorization) => {
    const token = bearerToken(authorization)
    if (!token) {
      return undefined
    }
    const staticUser = config.staticTokens.get(token)
    if (staticUser) {
      return { userId: staticUser }
    }
    if (config.devAuth && token.startsWith('dev-access-')) {
      return { userId: config.devUserId }
    }
    const session = await accounts.findSessionByAccess(hashToken(token))
    if (!session || session.revokedAt || session.accessExpiresAt <= now()) {
      return undefined
    }
    return { userId: session.userId }
  }
}
