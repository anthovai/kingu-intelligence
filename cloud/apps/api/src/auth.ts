import type { ApiConfig } from './config.js'

/** Who a request is from; artifacts and skills are owned by `userId`. */
export type Caller = { readonly userId: string }

/**
 * Resolves a bearer token to its owner. For now that is the dev-build token
 * (`KINGU_CLOUD_DEV_AUTH=1` on the desktop mints `dev-access-<uuid>` and sends
 * it here, a new one each sign-in, so they all map to one dev user) and static
 * tokens from the environment. Real desktop sign-in replaces this.
 */
export function resolveCaller(config: ApiConfig, authorization: string | undefined): Caller | undefined {
  const match = /^Bearer\s+(?<token>\S+)$/i.exec(authorization ?? '')
  const token = match?.groups?.token
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
  return undefined
}
