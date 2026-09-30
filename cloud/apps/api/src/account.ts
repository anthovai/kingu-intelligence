import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { AccountStore } from './account-store.js'
import type { Authenticate, Caller } from './auth.js'
import { effectivePlan, entitlementView, grantPlan, hashGrantCode, planView } from './entitlements.js'
import { findPlan } from './plans.js'

function error(c: Context, status: 400 | 401 | 404 | 409 | 422, code: string, message: string) {
  return c.json({ code, message }, status)
}

/** The signed-in account and its plan: `GET /v1/account`, and `POST /v1/account/redeem` for grant codes. */
export function accountRoutes(accounts: AccountStore, authenticate: Authenticate, now: () => Date = () => new Date()) {
  const api = new Hono<{ Variables: { caller: Caller } }>()

  api.use('*', async (c, next) => {
    const caller = await authenticate(c.req.header('authorization'))
    if (!caller) {
      return error(c, 401, 'invalid_access_token', 'Sign in to Kingu cloud again.')
    }
    c.set('caller', caller)
    await next()
  })

  const account = async (c: Context<{ Variables: { caller: Caller } }>) => {
    const user = await accounts.findUser(c.get('caller').userId)
    if (!user) {
      return undefined
    }
    const { plan, entitlement } = await effectivePlan(accounts, user.id, now())
    return { email: user.email, displayName: user.displayName, plan: planView(plan), entitlement: entitlementView(entitlement) }
  }

  api.get('/', async (c) => {
    const found = await account(c)
    return found ? c.json(found) : error(c, 404, 'account_not_found', 'This token belongs to no Kingu account.')
  })

  api.post('/redeem', async (c) => {
    const body = z.object({ code: z.string().trim().min(1).max(100) }).safeParse(await c.req.json().catch(() => undefined))
    if (!body.success) {
      return error(c, 422, 'invalid_request', 'Send {"code": "..."}.')
    }
    const user = await accounts.findUser(c.get('caller').userId)
    if (!user) {
      return error(c, 404, 'account_not_found', 'This token belongs to no Kingu account.')
    }
    const codeHash = hashGrantCode(body.data.code)
    const grantedBy = `code:${codeHash.slice(0, 16)}`
    if ((await accounts.listEntitlements(user.id)).some((e) => e.grantedBy === grantedBy)) {
      return error(c, 409, 'code_already_redeemed', 'This account already redeemed this code.')
    }
    const code = await accounts.useGrantCode(codeHash)
    const plan = code && findPlan(code.planId)
    if (!code || !plan) {
      return error(c, 404, 'invalid_code', 'This code is not valid or has been used up.')
    }
    await grantPlan(accounts, { user, plan, days: code.days, source: 'code', grantedBy }, now())
    return c.json(await account(c))
  })

  return api
}
