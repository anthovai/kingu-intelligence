/** An artifact as stored: its source, its rendered page and who may change it. */
export type StoredArtifact = {
  slug: string
  ownerId: string
  title: string | null
  originalFileName: string | null
  sourceContentType: 'text/html' | 'text/markdown'
  content: string
  renderedHtml: string
  byteSize: number
  /** Returned to the creator once and again on an idempotent replay; required to update or unshare. */
  editToken: string
  idempotencyKey: string | null
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  deletedAt: Date | null
}

export type ArtifactPage = { artifacts: StoredArtifact[]; nextCursor?: string }

export interface ArtifactStore {
  migrate(): Promise<void>
  findBySlug(slug: string): Promise<StoredArtifact | undefined>
  findByIdempotencyKey(ownerId: string, key: string): Promise<StoredArtifact | undefined>
  insert(artifact: StoredArtifact): Promise<void>
  update(artifact: StoredArtifact): Promise<void>
  /** The owner's live artifacts, newest first, `limit` at a time. */
  listByOwner(ownerId: string, limit: number, cursor: string | undefined, now: Date): Promise<ArtifactPage>
  close(): Promise<void>
}

/** Opaque to the client: the newest-first position of the last artifact on a page. */
export function encodeCursor(artifact: StoredArtifact): string {
  return Buffer.from(`${artifact.createdAt.toISOString()}|${artifact.slug}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; slug: string } | undefined {
  if (!cursor) {
    return undefined
  }
  const [iso, slug] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(iso ?? '')
  return slug && !Number.isNaN(createdAt.getTime()) ? { createdAt, slug } : undefined
}

function isLive(artifact: StoredArtifact, now: Date): boolean {
  return !artifact.deletedAt && artifact.expiresAt > now
}

/** Newest first; ties broken by slug so a cursor is a strict position. */
function newestFirst(a: StoredArtifact, b: StoredArtifact): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0)
}

/** For tests and a database-less local run. */
export class MemoryArtifactStore implements ArtifactStore {
  private readonly artifacts = new Map<string, StoredArtifact>()

  async migrate(): Promise<void> {}

  async findBySlug(slug: string): Promise<StoredArtifact | undefined> {
    const found = this.artifacts.get(slug)
    return found ? { ...found } : undefined
  }

  async findByIdempotencyKey(ownerId: string, key: string): Promise<StoredArtifact | undefined> {
    const found = [...this.artifacts.values()].find((artifact) => artifact.ownerId === ownerId && artifact.idempotencyKey === key)
    return found ? { ...found } : undefined
  }

  async insert(artifact: StoredArtifact): Promise<void> {
    this.artifacts.set(artifact.slug, { ...artifact })
  }

  async update(artifact: StoredArtifact): Promise<void> {
    this.artifacts.set(artifact.slug, { ...artifact })
  }

  async listByOwner(ownerId: string, limit: number, cursor: string | undefined, now: Date): Promise<ArtifactPage> {
    const after = decodeCursor(cursor)
    const owned = [...this.artifacts.values()]
      .filter((artifact) => artifact.ownerId === ownerId && isLive(artifact, now))
      .sort(newestFirst)
      .filter((artifact) => !after || newestFirst(artifact, { createdAt: after.createdAt, slug: after.slug } as StoredArtifact) > 0)
    const page = owned.slice(0, limit)
    return { artifacts: page.map((artifact) => ({ ...artifact })), nextCursor: owned.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]!) : undefined }
  }

  async close(): Promise<void> {}
}
