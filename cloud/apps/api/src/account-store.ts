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
  close(): Promise<void>
}

/** For tests and a database-less local run. */
export class MemoryAccountStore implements AccountStore {
  private readonly users = new Map<string, StoredUser>()
  private readonly codes = new Map<string, StoredAuthCode>()
  private readonly sessions = new Map<string, StoredAuthSession>()

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

  async close(): Promise<void> {}
}
