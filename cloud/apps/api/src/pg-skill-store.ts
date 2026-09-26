import pg from 'pg'
import type { SkillStore, StoredSkillPackage, StoredSkillShare, StoredSkillUpload, StoredSkillVersion } from './skill-store.js'

type UploadRow = {
  id: string
  owner_id: string
  idempotency_key: string | null
  expected_archive_sha256: string
  expected_compressed_bytes: number
  upload_token: string
  archive: Buffer | null
  package_id: string | null
  version_id: string | null
  created_at: Date
  expires_at: Date
}

type PackageRow = { id: string; owner_id: string; name: string; description: string; created_at: Date; deleted_at: Date | null }

type VersionRow = {
  package_id: string
  version_id: string
  name: string
  description: string
  package_digest: string
  archive_sha256: string
  compressed_bytes: number
  release_notes: string
  manifest: unknown
  created_at: Date
  deleted_at: Date | null
}

type ShareRow = {
  id: string
  package_id: string
  owner_id: string
  pinned_version_id: string | null
  idempotency_key: string | null
  created_at: Date
  revoked_at: Date | null
}

const VERSION_COLUMNS = 'package_id, version_id, name, description, package_digest, archive_sha256, compressed_bytes, release_notes, manifest, created_at, deleted_at'

function uploadFromRow(row: UploadRow): StoredSkillUpload {
  return {
    id: row.id,
    ownerId: row.owner_id,
    idempotencyKey: row.idempotency_key,
    expectedArchiveSha256: row.expected_archive_sha256,
    expectedCompressedBytes: row.expected_compressed_bytes,
    uploadToken: row.upload_token,
    archive: row.archive,
    packageId: row.package_id,
    versionId: row.version_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at
  }
}

function packageFromRow(row: PackageRow): StoredSkillPackage {
  return { id: row.id, ownerId: row.owner_id, name: row.name, description: row.description, createdAt: row.created_at, deletedAt: row.deleted_at }
}

function versionFromRow(row: VersionRow): StoredSkillVersion {
  return {
    packageId: row.package_id,
    versionId: row.version_id,
    name: row.name,
    description: row.description,
    packageDigest: row.package_digest,
    archiveSha256: row.archive_sha256,
    compressedBytes: row.compressed_bytes,
    releaseNotes: row.release_notes,
    manifest: row.manifest,
    createdAt: row.created_at,
    deletedAt: row.deleted_at
  }
}

function shareFromRow(row: ShareRow): StoredSkillShare {
  return {
    id: row.id,
    packageId: row.package_id,
    ownerId: row.owner_id,
    pinnedVersionId: row.pinned_version_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    revokedAt: row.revoked_at
  }
}

/** Archives (at most 40 MiB) live in Postgres beside their rows, so one backup holds everything. */
export class PgSkillStore implements SkillStore {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 })
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS skill_uploads (
        id text PRIMARY KEY,
        owner_id text NOT NULL,
        idempotency_key text,
        expected_archive_sha256 text NOT NULL,
        expected_compressed_bytes integer NOT NULL,
        upload_token text NOT NULL,
        archive bytea,
        package_id text,
        version_id text,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS skill_uploads_owner_idempotency ON skill_uploads (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS skill_packages (
        id text PRIMARY KEY,
        owner_id text NOT NULL,
        name text NOT NULL,
        description text NOT NULL,
        created_at timestamptz NOT NULL,
        deleted_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS skill_versions (
        package_id text NOT NULL REFERENCES skill_packages (id),
        version_id text NOT NULL,
        name text NOT NULL,
        description text NOT NULL,
        package_digest text NOT NULL,
        archive_sha256 text NOT NULL,
        compressed_bytes integer NOT NULL,
        release_notes text NOT NULL,
        manifest jsonb NOT NULL,
        archive bytea NOT NULL,
        created_at timestamptz NOT NULL,
        deleted_at timestamptz,
        PRIMARY KEY (package_id, version_id)
      );
      CREATE TABLE IF NOT EXISTS skill_shares (
        id text PRIMARY KEY,
        package_id text NOT NULL REFERENCES skill_packages (id),
        owner_id text NOT NULL,
        pinned_version_id text,
        idempotency_key text,
        created_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS skill_shares_owner_idempotency ON skill_shares (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS skill_shares_owner ON skill_shares (owner_id, created_at DESC);
    `)
  }

  async findUpload(id: string) {
    const result = await this.pool.query<UploadRow>('SELECT * FROM skill_uploads WHERE id = $1', [id])
    return result.rows[0] ? uploadFromRow(result.rows[0]) : undefined
  }

  async findUploadByIdempotencyKey(ownerId: string, key: string) {
    const result = await this.pool.query<UploadRow>('SELECT * FROM skill_uploads WHERE owner_id = $1 AND idempotency_key = $2', [ownerId, key])
    return result.rows[0] ? uploadFromRow(result.rows[0]) : undefined
  }

  async insertUpload(u: StoredSkillUpload) {
    await this.pool.query(
      `INSERT INTO skill_uploads (id, owner_id, idempotency_key, expected_archive_sha256, expected_compressed_bytes, upload_token, archive, package_id, version_id, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [u.id, u.ownerId, u.idempotencyKey, u.expectedArchiveSha256, u.expectedCompressedBytes, u.uploadToken, u.archive, u.packageId, u.versionId, u.createdAt, u.expiresAt]
    )
  }

  async updateUpload(u: StoredSkillUpload) {
    await this.pool.query('UPDATE skill_uploads SET archive = $2, package_id = $3, version_id = $4 WHERE id = $1', [u.id, u.archive, u.packageId, u.versionId])
  }

  async findPackage(id: string) {
    const result = await this.pool.query<PackageRow>('SELECT * FROM skill_packages WHERE id = $1', [id])
    return result.rows[0] ? packageFromRow(result.rows[0]) : undefined
  }

  async upsertPackage(p: StoredSkillPackage) {
    await this.pool.query(
      `INSERT INTO skill_packages (id, owner_id, name, description, created_at, deleted_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, deleted_at = EXCLUDED.deleted_at`,
      [p.id, p.ownerId, p.name, p.description, p.createdAt, p.deletedAt]
    )
  }

  async listVersions(packageId: string) {
    const result = await this.pool.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM skill_versions WHERE package_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [packageId])
    return result.rows.map(versionFromRow)
  }

  async findVersion(packageId: string, versionId: string) {
    const result = await this.pool.query<VersionRow>(`SELECT ${VERSION_COLUMNS} FROM skill_versions WHERE package_id = $1 AND version_id = $2`, [packageId, versionId])
    return result.rows[0] ? versionFromRow(result.rows[0]) : undefined
  }

  async insertVersion(v: StoredSkillVersion, archive: Buffer) {
    await this.pool.query(
      `INSERT INTO skill_versions (${VERSION_COLUMNS}, archive) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [v.packageId, v.versionId, v.name, v.description, v.packageDigest, v.archiveSha256, v.compressedBytes, v.releaseNotes, JSON.stringify(v.manifest), v.createdAt, v.deletedAt, archive]
    )
  }

  async updateVersion(v: StoredSkillVersion) {
    await this.pool.query('UPDATE skill_versions SET deleted_at = $3 WHERE package_id = $1 AND version_id = $2', [v.packageId, v.versionId, v.deletedAt])
  }

  async readArchive(packageId: string, versionId: string) {
    const result = await this.pool.query<{ archive: Buffer }>('SELECT archive FROM skill_versions WHERE package_id = $1 AND version_id = $2', [packageId, versionId])
    return result.rows[0]?.archive
  }

  async findShare(id: string) {
    const result = await this.pool.query<ShareRow>('SELECT * FROM skill_shares WHERE id = $1', [id])
    return result.rows[0] ? shareFromRow(result.rows[0]) : undefined
  }

  async findShareByIdempotencyKey(ownerId: string, key: string) {
    const result = await this.pool.query<ShareRow>('SELECT * FROM skill_shares WHERE owner_id = $1 AND idempotency_key = $2', [ownerId, key])
    return result.rows[0] ? shareFromRow(result.rows[0]) : undefined
  }

  async insertShare(s: StoredSkillShare) {
    await this.pool.query(
      'INSERT INTO skill_shares (id, package_id, owner_id, pinned_version_id, idempotency_key, created_at, revoked_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [s.id, s.packageId, s.ownerId, s.pinnedVersionId, s.idempotencyKey, s.createdAt, s.revokedAt]
    )
  }

  async updateShare(s: StoredSkillShare) {
    await this.pool.query('UPDATE skill_shares SET revoked_at = $2 WHERE id = $1', [s.id, s.revokedAt])
  }

  async listShares(filter: { ownerId?: string; packageId?: string }) {
    const result = await this.pool.query<ShareRow>(
      `SELECT * FROM skill_shares WHERE revoked_at IS NULL AND ($1::text IS NULL OR owner_id = $1) AND ($2::text IS NULL OR package_id = $2) ORDER BY created_at DESC`,
      [filter.ownerId ?? null, filter.packageId ?? null]
    )
    return result.rows.map(shareFromRow)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
