import { randomBytes } from 'node:crypto'
import { z } from 'zod'

/**
 * The API that the desktop's Artifacts, Skills and cloud sign-in talk to. One
 * origin serves both the JSON API (`/v1/...`) and the public pages
 * (`/a/<slug>`, `/skills/share/<id>`), so a deployment is one service behind
 * one domain (kingu.anthovai.com), and a local run is one port.
 */
const configSchema = z.object({
  port: z.number().int().positive(),
  /** Origin the share links point at, e.g. `https://kingu.anthovai.com` or `http://127.0.0.1:8787`. */
  publicUrl: z.string().url(),
  /** Postgres connection string; unset keeps everything in memory (tests, quick local runs). */
  databaseUrl: z.string().min(1).optional(),
  /** Accept the desktop's dev-build `dev-access-*` tokens as one fixed dev user. Never in production. */
  devAuth: z.boolean(),
  devUserId: z.string().min(1),
  /** `token=userId` pairs accepted as bearer tokens, for scripts and the CLI before real sign-in exists. */
  staticTokens: z.map(z.string(), z.string()),
  /** How long an artifact stays shared after its last write. */
  artifactTtlDays: z.number().int().positive(),
  /** Signs skill download grants. Unset, a fresh one per process: grants live 15 minutes, so a restart only fails downloads in flight. */
  grantSecret: z.string().min(32),
  /** The desktop's OAuth client id (`KINGU_CLOUD_CLIENT_ID`). */
  clientId: z.string().min(1),
  /** Who may create an account: addresses, `@domain` entries, or `*` for anyone. Empty: nobody. */
  allowedEmails: z.array(z.string())
})

export type ApiConfig = z.infer<typeof configSchema>

function parseStaticTokens(raw: string | undefined): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const pair of (raw ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const separator = pair.indexOf('=')
    if (separator > 0) {
      tokens.set(pair.slice(0, separator), pair.slice(separator + 1))
    }
  }
  return tokens
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PORT ?? 8787)
  const config = configSchema.parse({
    port,
    publicUrl: (env.KINGU_API_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    databaseUrl: env.DATABASE_URL || undefined,
    devAuth: env.KINGU_API_DEV_AUTH === '1',
    devUserId: env.KINGU_API_DEV_USER_ID ?? 'dev-user',
    staticTokens: parseStaticTokens(env.KINGU_API_STATIC_TOKENS),
    artifactTtlDays: Number(env.KINGU_API_ARTIFACT_TTL_DAYS ?? 30),
    grantSecret: env.KINGU_API_GRANT_SECRET || randomBytes(32).toString('base64url'),
    clientId: env.KINGU_API_CLIENT_ID ?? 'kingu-desktop',
    allowedEmails: (env.KINGU_API_ALLOWED_EMAILS ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  })
  if (config.devAuth && env.NODE_ENV === 'production') {
    throw new Error('KINGU_API_DEV_AUTH=1 is refused when NODE_ENV=production.')
  }
  return config
}
