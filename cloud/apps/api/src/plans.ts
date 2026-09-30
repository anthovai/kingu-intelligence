/**
 * What a Kingu account can use. Plans live in code, not a table: a plan is a
 * product decision shipped with the API, while who has which plan (and until
 * when) is an entitlement row in the account store (`entitlements.ts`).
 */
export type Plan = {
  id: string
  name: string
  /** Kingu-cloud model tokens per day; `null` = no cloud allowance is metered (Arkai runs on your own models). */
  dailyTokens: number | null
  /** Capability flags the desktop sees in `capabilities.flags`. */
  features: readonly string[]
}

/** Everyone keeps sharing, whatever their plan, so no plan change takes it away. */
export const BASE_FEATURES = ['share', 'share.create', 'share.manage'] as const

export const PLANS = {
  free: { id: 'free', name: 'Free', dailyTokens: null, features: ['arkai', ...BASE_FEATURES] },
  arkai_pro: { id: 'arkai_pro', name: 'Arkai Pro', dailyTokens: 2_000_000, features: ['arkai', 'arkai.pro', ...BASE_FEATURES] }
} as const satisfies Record<string, Plan>

export type PlanId = keyof typeof PLANS

export const DEFAULT_PLAN: Plan = PLANS.free

export function findPlan(id: string): Plan | undefined {
  return Object.hasOwn(PLANS, id) ? PLANS[id as PlanId] : undefined
}

/** A plan's features as the desktop's `capabilities.flags`. */
export function planFlags(plan: Plan): Record<string, boolean> {
  return Object.fromEntries([...BASE_FEATURES, ...plan.features].map((feature) => [feature, true]))
}
