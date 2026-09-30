/**
 * Grant a plan by email from the server, without an admin token:
 *
 *   docker compose -f deploy/compose.prod.yaml --env-file deploy/.env exec api \
 *     node apps/api/dist/admin/grant.js --email someone@example.com --plan arkai_pro --days 30 --note "beta"
 *
 * `--revoke <entitlementId>` revokes instead; `--list --email <email>` shows that account's entitlements.
 * Uses DATABASE_URL (the container already has it). Locally: `pnpm grant -- --email ... --plan ...` after a build.
 */
import { parseArgs } from 'node:util'
import { PgAccountStore } from '../pg-account-store.js'
import { activeEntitlement, grantPlan } from '../entitlements.js'
import { findPlan, PLANS } from '../plans.js'

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    plan: { type: 'string' },
    days: { type: 'string' },
    note: { type: 'string' },
    revoke: { type: 'string' },
    list: { type: 'boolean' }
  }
})

function fail(message: string): never {
  console.error(message)
  console.error('Usage: grant --email <email> --plan <' + Object.keys(PLANS).join('|') + '> [--days N] [--note text]\n       grant --revoke <entitlementId>\n       grant --list --email <email>')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  fail('DATABASE_URL is not set.')
}

const accounts = new PgAccountStore(databaseUrl)
try {
  await accounts.migrate()
  const now = new Date()
  if (values.revoke) {
    console.log((await accounts.revokeEntitlement(values.revoke, now)) ? `Revoked ${values.revoke}.` : `No live entitlement ${values.revoke}.`)
  } else {
    const email = values.email?.trim().toLowerCase()
    if (!email) {
      fail('--email is required.')
    }
    const user = await accounts.findUserByEmail(email)
    if (!user) {
      fail(`No Kingu account uses ${email}. They sign up from Kingu first.`)
    }
    if (values.list) {
      const entitlements = await accounts.listEntitlements(user.id)
      const active = activeEntitlement(entitlements, now)
      for (const e of entitlements) {
        console.log(`${e.id === active?.id ? '*' : ' '} ${e.id} ${e.planId} ${e.source} ${e.startsAt.toISOString()} → ${e.endsAt?.toISOString() ?? 'no end'}${e.revokedAt ? ' (revoked)' : ''}${e.note ? ` — ${e.note}` : ''}`)
      }
      console.log(entitlements.length ? '(* = in force)' : 'No entitlements: plan is free.')
    } else {
      const plan = findPlan(values.plan ?? '')
      if (!plan) {
        fail(`--plan must be one of: ${Object.keys(PLANS).join(', ')}.`)
      }
      const days = values.days === undefined ? undefined : Number(values.days)
      if (days !== undefined && (!Number.isInteger(days) || days <= 0)) {
        fail('--days must be a positive whole number.')
      }
      const entitlement = await grantPlan(accounts, { user, plan, days, note: values.note, source: 'admin', grantedBy: 'cli' }, now)
      console.log(`Granted ${plan.name} to ${email} until ${entitlement.endsAt?.toISOString() ?? 'revoked'} (${entitlement.id}).`)
    }
  }
} finally {
  await accounts.close()
}
