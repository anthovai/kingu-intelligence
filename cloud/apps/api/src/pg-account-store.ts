import pg from 'pg'
import type { AccountStore, StoredAuthCode, StoredAuthSession, StoredUser } from './account-store.js'

type UserRow = {
  id: string
  email: string
  display_name: string | null
  password_hash: string
  cloud_profile_id: string
  personal_org_id: string
  created_at: Date
}

type CodeRow = {
  code_hash: string
  user_id: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  nonce: string
  local_profile_id: string | null
  expires_at: Date
  used_at: Date | null
}

type SessionRow = {
  id: string
  user_id: string
  cloud_profile_id: string
  active_org_id: string
  access_hash: string
  access_expires_at: Date
  refresh_hash: string
  previous_refresh_hash: string | null
  rotated_at: Date
  refresh_expires_at: Date
  created_at: Date
  revoked_at: Date | null
}

function userFromRow(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    cloudProfileId: row.cloud_profile_id,
    personalOrgId: row.personal_org_id,
    createdAt: row.created_at
  }
}

function codeFromRow(row: CodeRow): StoredAuthCode {
  return {
    codeHash: row.code_hash,
    userId: row.user_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    nonce: row.nonce,
    localProfileId: row.local_profile_id,
    expiresAt: row.expires_at,
    usedAt: row.used_at
  }
}

function sessionFromRow(row: SessionRow): StoredAuthSession {
  return {
    id: row.id,
    userId: row.user_id,
    cloudProfileId: row.cloud_profile_id,
    activeOrgId: row.active_org_id,
    accessHash: row.access_hash,
    accessExpiresAt: row.access_expires_at,
    refreshHash: row.refresh_hash,
    previousRefreshHash: row.previous_refresh_hash,
    rotatedAt: row.rotated_at,
    refreshExpiresAt: row.refresh_expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at
  }
}

export class PgAccountStore implements AccountStore {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 })
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id text PRIMARY KEY,
        email text NOT NULL UNIQUE,
        display_name text,
        password_hash text NOT NULL,
        cloud_profile_id text NOT NULL,
        personal_org_id text NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_codes (
        code_hash text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users (id),
        client_id text NOT NULL,
        redirect_uri text NOT NULL,
        code_challenge text NOT NULL,
        nonce text NOT NULL,
        local_profile_id text,
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id text PRIMARY KEY,
        user_id text NOT NULL REFERENCES users (id),
        cloud_profile_id text NOT NULL,
        active_org_id text NOT NULL,
        access_hash text NOT NULL UNIQUE,
        access_expires_at timestamptz NOT NULL,
        refresh_hash text NOT NULL UNIQUE,
        previous_refresh_hash text,
        rotated_at timestamptz NOT NULL,
        refresh_expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_previous_refresh ON auth_sessions (previous_refresh_hash);
    `)
  }

  async findUserByEmail(email: string) {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email])
    return result.rows[0] ? userFromRow(result.rows[0]) : undefined
  }

  async findUser(id: string) {
    const result = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id])
    return result.rows[0] ? userFromRow(result.rows[0]) : undefined
  }

  async insertUser(u: StoredUser) {
    await this.pool.query(
      'INSERT INTO users (id, email, display_name, password_hash, cloud_profile_id, personal_org_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [u.id, u.email, u.displayName, u.passwordHash, u.cloudProfileId, u.personalOrgId, u.createdAt]
    )
  }

  async insertCode(c: StoredAuthCode) {
    await this.pool.query(
      'INSERT INTO auth_codes (code_hash, user_id, client_id, redirect_uri, code_challenge, nonce, local_profile_id, expires_at, used_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [c.codeHash, c.userId, c.clientId, c.redirectUri, c.codeChallenge, c.nonce, c.localProfileId, c.expiresAt, c.usedAt]
    )
  }

  async takeCode(codeHash: string, now: Date) {
    // One statement, so two redemptions racing cannot both win.
    const result = await this.pool.query<CodeRow>('UPDATE auth_codes SET used_at = $2 WHERE code_hash = $1 AND used_at IS NULL RETURNING *', [codeHash, now])
    return result.rows[0] ? codeFromRow(result.rows[0]) : undefined
  }

  async insertSession(s: StoredAuthSession) {
    await this.pool.query(
      `INSERT INTO auth_sessions (id, user_id, cloud_profile_id, active_org_id, access_hash, access_expires_at, refresh_hash, previous_refresh_hash, rotated_at, refresh_expires_at, created_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [s.id, s.userId, s.cloudProfileId, s.activeOrgId, s.accessHash, s.accessExpiresAt, s.refreshHash, s.previousRefreshHash, s.rotatedAt, s.refreshExpiresAt, s.createdAt, s.revokedAt]
    )
  }

  async updateSession(s: StoredAuthSession) {
    await this.pool.query(
      `UPDATE auth_sessions SET active_org_id = $2, access_hash = $3, access_expires_at = $4, refresh_hash = $5, previous_refresh_hash = $6, rotated_at = $7, refresh_expires_at = $8, revoked_at = $9 WHERE id = $1`,
      [s.id, s.activeOrgId, s.accessHash, s.accessExpiresAt, s.refreshHash, s.previousRefreshHash, s.rotatedAt, s.refreshExpiresAt, s.revokedAt]
    )
  }

  async findSessionByAccess(accessHash: string) {
    const result = await this.pool.query<SessionRow>('SELECT * FROM auth_sessions WHERE access_hash = $1', [accessHash])
    return result.rows[0] ? sessionFromRow(result.rows[0]) : undefined
  }

  async findSessionByRefresh(refreshHash: string) {
    const result = await this.pool.query<SessionRow>('SELECT * FROM auth_sessions WHERE refresh_hash = $1 OR previous_refresh_hash = $1 LIMIT 1', [refreshHash])
    return result.rows[0] ? sessionFromRow(result.rows[0]) : undefined
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
