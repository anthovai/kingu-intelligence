import pg from 'pg'
import { decodeCursor, encodeCursor, type ArtifactPage, type ArtifactStore, type StoredArtifact } from './artifact-store.js'

type Row = {
  slug: string
  owner_id: string
  title: string | null
  original_file_name: string | null
  source_content_type: 'text/html' | 'text/markdown'
  content: string
  rendered_html: string
  byte_size: number
  edit_token: string
  idempotency_key: string | null
  created_at: Date
  updated_at: Date
  expires_at: Date
  deleted_at: Date | null
}

function fromRow(row: Row): StoredArtifact {
  return {
    slug: row.slug,
    ownerId: row.owner_id,
    title: row.title,
    originalFileName: row.original_file_name,
    sourceContentType: row.source_content_type,
    content: row.content,
    renderedHtml: row.rendered_html,
    byteSize: row.byte_size,
    editToken: row.edit_token,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    deletedAt: row.deleted_at
  }
}

export class PgArtifactStore implements ArtifactStore {
  private readonly pool: pg.Pool

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 })
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS artifacts (
        slug text PRIMARY KEY,
        owner_id text NOT NULL,
        title text,
        original_file_name text,
        source_content_type text NOT NULL,
        content text NOT NULL,
        rendered_html text NOT NULL,
        byte_size integer NOT NULL,
        edit_token text NOT NULL,
        idempotency_key text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS artifacts_owner_idempotency ON artifacts (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS artifacts_owner_created ON artifacts (owner_id, created_at DESC, slug DESC);
    `)
  }

  async findBySlug(slug: string): Promise<StoredArtifact | undefined> {
    const result = await this.pool.query<Row>('SELECT * FROM artifacts WHERE slug = $1', [slug])
    return result.rows[0] ? fromRow(result.rows[0]) : undefined
  }

  async findByIdempotencyKey(ownerId: string, key: string): Promise<StoredArtifact | undefined> {
    const result = await this.pool.query<Row>('SELECT * FROM artifacts WHERE owner_id = $1 AND idempotency_key = $2', [ownerId, key])
    return result.rows[0] ? fromRow(result.rows[0]) : undefined
  }

  async insert(a: StoredArtifact): Promise<void> {
    await this.pool.query(
      `INSERT INTO artifacts (slug, owner_id, title, original_file_name, source_content_type, content, rendered_html, byte_size, edit_token, idempotency_key, created_at, updated_at, expires_at, deleted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [a.slug, a.ownerId, a.title, a.originalFileName, a.sourceContentType, a.content, a.renderedHtml, a.byteSize, a.editToken, a.idempotencyKey, a.createdAt, a.updatedAt, a.expiresAt, a.deletedAt]
    )
  }

  async update(a: StoredArtifact): Promise<void> {
    await this.pool.query(
      `UPDATE artifacts SET title = $2, original_file_name = $3, source_content_type = $4, content = $5, rendered_html = $6, byte_size = $7, updated_at = $8, expires_at = $9, deleted_at = $10 WHERE slug = $1`,
      [a.slug, a.title, a.originalFileName, a.sourceContentType, a.content, a.renderedHtml, a.byteSize, a.updatedAt, a.expiresAt, a.deletedAt]
    )
  }

  async listByOwner(ownerId: string, limit: number, cursor: string | undefined, now: Date): Promise<ArtifactPage> {
    const after = decodeCursor(cursor)
    const result = await this.pool.query<Row>(
      `SELECT * FROM artifacts
       WHERE owner_id = $1 AND deleted_at IS NULL AND expires_at > $2
         AND ($3::timestamptz IS NULL OR (created_at, slug) < ($3::timestamptz, $4::text))
       ORDER BY created_at DESC, slug DESC
       LIMIT $5`,
      [ownerId, now, after?.createdAt ?? null, after?.slug ?? '', limit + 1]
    )
    const rows = result.rows.map(fromRow)
    const page = rows.slice(0, limit)
    return { artifacts: page, nextCursor: rows.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : undefined }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
