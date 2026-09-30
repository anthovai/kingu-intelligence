import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { AccountStore } from './account-store.js'
import { bearerToken } from './auth.js'
import type { ApiConfig } from './config.js'
import { grantPlan, hashGrantCode, newGrantCode } from './entitlements.js'
import { findPlan, PLANS } from './plans.js'

const planIdSchema = z.string().refine((id) => findPlan(id) !== undefined, { message: `planId must be one of: ${Object.keys(PLANS).join(', ')}` })

const grantSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  planId: planIdSchema,
  days: z.number().int().positive().max(3650).optional(),
  note: z.string().max(500).optional()
})

const grantCodeSchema = z.object({
  planId: planIdSchema,
  days: z.number().int().positive().max(3650),
  maxUses: z.number().int().positive().max(100_000)
})

function error(c: Context, status: 401 | 403 | 404 | 422, code: string, message: string) {
  return c.json({ code, message }, status)
}

function entitlementJson(e: { id: string; userId: string; planId: string; startsAt: Date; endsAt: Date | null; source: string; note: string | null; grantedBy: string | null }) {
  return { id: e.id, userId: e.userId, planId: e.planId, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, source: e.source, note: e.note, grantedBy: e.grantedBy }
}

/**
 * Granting plans by hand until a payment provider exists: an admin grants an
 * entitlement by email, revokes one, or mints a grant code for people to
 * redeem. Only for `KINGU_API_ADMIN_TOKENS`; with none set, all of it is off.
 */
export function adminRoutes(config: ApiConfig, accounts: AccountStore, now: () => Date = () => new Date()) {
  const api = new Hono<{ Variables: { admin: string } }>()

  api.use('*', async (c, next) => {
    if (config.adminTokens.size === 0) {
      return error(c, 403, 'admin_disabled', 'No admin tokens are configured (KINGU_API_ADMIN_TOKENS).')
    }
    const token = bearerToken(c.req.header('authorization'))
    const admin = token ? config.adminTokens.get(token) : undefined
    if (!admin) {
      return error(c, 401, 'invalid_admin_token', 'An admin token is required.')
    }
    c.set('admin', admin)
    await next()
  })

  api.post('/entitlements', async (c) => {
    const body = grantSchema.safeParse(await c.req.json().catch(() => undefined))
    if (!body.success) {
      return error(c, 422, 'invalid_request', body.error.issues[0]?.message ?? 'Invalid request.')
    }
    const user = await accounts.findUserByEmail(body.data.email)
    if (!user) {
      return error(c, 404, 'account_not_found', `No Kingu account uses ${body.data.email}.`)
    }
    const entitlement = await grantPlan(accounts, { user, plan: findPlan(body.data.planId)!, days: body.data.days, note: body.data.note, source: 'admin', grantedBy: c.get('admin') }, now())
    return c.json({ entitlement: entitlementJson(entitlement) }, 201)
  })

  api.delete('/entitlements/:id', async (c) => {
    if (!(await accounts.revokeEntitlement(c.req.param('id'), now()))) {
      return error(c, 404, 'entitlement_not_found', 'No live entitlement has this id.')
    }
    return c.json({ ok: true })
  })

  api.post('/grant-codes', async (c) => {
    const body = grantCodeSchema.safeParse(await c.req.json().catch(() => undefined))
    if (!body.success) {
      return error(c, 422, 'invalid_request', body.error.issues[0]?.message ?? 'Invalid request.')
    }
    const code = newGrantCode()
    await accounts.insertGrantCode({ codeHash: hashGrantCode(code), planId: body.data.planId, days: body.data.days, maxUses: body.data.maxUses, uses: 0, createdAt: now() })
    // The plaintext is shown here once; only its hash is stored.
    return c.json({ code, planId: body.data.planId, days: body.data.days, maxUses: body.data.maxUses }, 201)
  })

  return api
}
