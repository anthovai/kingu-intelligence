import { randomBytes, randomUUID } from 'node:crypto'
import type { AccountStore, EntitlementSource, StoredEntitlement, StoredUser } from './account-store.js'
import { hashToken } from './auth.js'
import { DEFAULT_PLAN, findPlan, type Plan } from './plans.js'

const DAY_MS = 86_400_000

/** The entitlement in force: the most recently granted one that is not revoked and is active at `at`. */
export function activeEntitlement(entitlements: readonly StoredEntitlement[], at: Date): StoredEntitlement | undefined {
  return entitlements
    .filter((e) => !e.revokedAt && e.startsAt <= at && (!e.endsAt || e.endsAt > at) && findPlan(e.planId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.startsAt.getTime() - a.startsAt.getTime())[0]
}

/** A user's plan now: from their active entitlement, else `free`. */
export async function effectivePlan(accounts: AccountStore, userId: string, at: Date): Promise<{ plan: Plan; entitlement: StoredEntitlement | null }> {
  const entitlement = activeEntitlement(await accounts.listEntitlements(userId), at)
  return { plan: (entitlement && findPlan(entitlement.planId)) || DEFAULT_PLAN, entitlement: entitlement ?? null }
}

export function planView(plan: Plan) {
  return { id: plan.id, name: plan.name, dailyTokens: plan.dailyTokens, features: [...plan.features] }
}

export function entitlementView(entitlement: StoredEntitlement | null) {
  return entitlement ? { id: entitlement.id, endsAt: entitlement.endsAt?.toISOString() ?? null, source: entitlement.source } : null
}

export type GrantRequest = { user: StoredUser; plan: Plan; days?: number | undefined; note?: string | null | undefined; source: EntitlementSource; grantedBy: string | null }

/** Grants `plan` from now for `days` (no end when omitted). */
export async function grantPlan(accounts: AccountStore, request: GrantRequest, at: Date): Promise<StoredEntitlement> {
  const entitlement: StoredEntitlement = {
    id: `ent_${randomUUID()}`,
    userId: request.user.id,
    planId: request.plan.id,
    startsAt: at,
    endsAt: request.days ? new Date(at.getTime() + request.days * DAY_MS) : null,
    source: request.source,
    note: request.note ?? null,
    grantedBy: request.grantedBy,
    createdAt: at,
    revokedAt: null
  }
  await accounts.insertEntitlement(entitlement)
  return entitlement
}

/** Codes are typed by people: case and surrounding spaces do not matter. */
export function normalizeGrantCode(code: string): string {
  return code.trim().toUpperCase()
}

export function hashGrantCode(code: string): string {
  return hashToken(normalizeGrantCode(code))
}

/** `KINGU-XXXX-XXXX-XXXX-XXXX`, from an alphabet without look-alike characters (80 bits). */
export function newGrantCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const chars = [...randomBytes(16)].map((byte) => alphabet[byte % alphabet.length]).join('')
  return `KINGU-${chars.match(/.{4}/g)!.join('-')}`
}
