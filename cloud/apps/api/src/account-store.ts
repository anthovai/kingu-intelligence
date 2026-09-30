/** A Kingu cloud account: one person, signing in with email and password. */
export type StoredUser = {
  id: string
  /** Lower-cased; unique. */
  email: string
  displayName: string | null
  passwordHash: string
  /** The one cloud profile the desktop links to, and the personal org it works in. */
  cloudProfileId: string
  personalOrgId: string
  createdAt: Date
}

/** A one-time authorization code from the sign-in page, redeemed once at `/session`. */
export type StoredAuthCode = {
  codeHash: string
  userId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  nonce: string
  localProfileId: string | null
  expiresAt: Date
  usedAt: Date | null
}

/**
 * One desktop sign-in. Only hashes of its tokens are kept; each refresh
 * rotates both. The previous refresh token stays valid for a short grace so a
 * refresh whose answer was lost is not mistaken for token theft.
 */
export type StoredAuthSession = {
  id: string
  userId: string
  cloudProfileId: string
  activeOrgId: string
  accessHash: string
  accessExpiresAt: Date
  refreshHash: string
  previousRefreshHash: string | null
  rotatedAt: Date
  refreshExpiresAt: Date
  createdAt: Date
  revokedAt: Date | null
}

/** Where an entitlement came from; a payment provider will add `payment` rows. */
export type EntitlementSource = 'admin' | 'code' | 'payment'

/** A plan held by a user from `startsAt` until `endsAt` (`null`: no end), unless revoked. */
export type StoredEntitlement = {
  id: string
  userId: string
  planId: string
  startsAt: Date
  endsAt: Date | null
  source: EntitlementSource
  note: string | null
  /** An admin token's name, `cli`, or `code:<hash prefix>` for a redeemed grant code. */
  grantedBy: string | null
  createdAt: Date
  revokedAt: Date | null
}

/** A code that grants a plan for `days` to up to `maxUses` accounts. Only its sha256 is kept. */
export type StoredGrantCode = {
  codeHash: string
  planId: string
  days: number
  maxUses: number
  uses: number
  createdAt: Date
}

export interface AccountStore {
  migrate(): Promise<void>
  findUserByEmail(email: string): Promise<StoredUser | undefined>
  findUser(id: string): Promise<StoredUser | undefined>
  insertUser(user: StoredUser): Promise<void>
  insertCode(code: StoredAuthCode): Promise<void>
  /** Marks the code used and returns it, or `undefined` if it is unknown or already used. */
  takeCode(codeHash: string, now: Date): Promise<StoredAuthCode | undefined>
  insertSession(session: StoredAuthSession): Promise<void>
  updateSession(session: StoredAuthSession): Promise<void>
  findSessionByAccess(accessHash: string): Promise<StoredAuthSession | undefined>
  /** By the current refresh token, or the one just rotated away. */
  findSessionByRefresh(refreshHash: string): Promise<StoredAuthSession | undefined>
  insertEntitlement(entitlement: StoredEntitlement): Promise<void>
  listEntitlements(userId: string): Promise<StoredEntitlement[]>
  /** Revokes a live entitlement; `false` when it is unknown or already revoked. */
  revokeEntitlement(id: string, now: Date): Promise<boolean>
  insertGrantCode(code: StoredGrantCode): Promise<void>
  /** Counts one use and returns the code, or `undefined` if it is unknown or used up. */
  useGrantCode(codeHash: string): Promise<StoredGrantCode | undefined>
  close(): Promise<void>
}

/** For tests and a database-less local run. */
export class MemoryAccountStore implements AccountStore {
  private readonly users = new Map<string, StoredUser>()
  private readonly codes = new Map<string, StoredAuthCode>()
  private readonly sessions = new Map<string, StoredAuthSession>()
  private readonly entitlements = new Map<string, StoredEntitlement>()
  private readonly grantCodes = new Map<string, StoredGrantCode>()

  async migrate(): Promise<void> {}

  async findUserByEmail(email: string) {
    const found = [...this.users.values()].find((user) => user.email === email)
    return found ? { ...found } : undefined
  }

  async findUser(id: string) {
    const found = this.users.get(id)
    return found ? { ...found } : undefined
  }

  async insertUser(user: StoredUser) {
    if ([...this.users.values()].some((existing) => existing.email === user.email)) {
      throw new Error('duplicate email')
    }
    this.users.set(user.id, { ...user })
  }

  async insertCode(code: StoredAuthCode) {
    this.codes.set(code.codeHash, { ...code })
  }

  async takeCode(codeHash: string, now: Date) {
    const found = this.codes.get(codeHash)
    if (!found || found.usedAt) {
      return undefined
    }
    found.usedAt = now
    return { ...found }
  }

  async insertSession(session: StoredAuthSession) {
    this.sessions.set(session.id, { ...session })
  }

  async updateSession(session: StoredAuthSession) {
    this.sessions.set(session.id, { ...session })
  }

  async findSessionByAccess(accessHash: string) {
    const found = [...this.sessions.values()].find((session) => session.accessHash === accessHash)
    return found ? { ...found } : undefined
  }

  async findSessionByRefresh(refreshHash: string) {
    const found = [...this.sessions.values()].find((session) => session.refreshHash === refreshHash || session.previousRefreshHash === refreshHash)
    return found ? { ...found } : undefined
  }

  async insertEntitlement(entitlement: StoredEntitlement) {
    this.entitlements.set(entitlement.id, { ...entitlement })
  }

  async listEntitlements(userId: string) {
    return [...this.entitlements.values()].filter((entitlement) => entitlement.userId === userId).map((entitlement) => ({ ...entitlement }))
  }

  async revokeEntitlement(id: string, now: Date) {
    const found = this.entitlements.get(id)
    if (!found || found.revokedAt) {
      return false
    }
    found.revokedAt = now
    return true
  }

  async insertGrantCode(code: StoredGrantCode) {
    this.grantCodes.set(code.codeHash, { ...code })
  }

  async useGrantCode(codeHash: string) {
    const found = this.grantCodes.get(codeHash)
    if (!found || found.uses >= found.maxUses) {
      return undefined
    }
    found.uses++
    return { ...found }
  }

  async close(): Promise<void> {}
}
