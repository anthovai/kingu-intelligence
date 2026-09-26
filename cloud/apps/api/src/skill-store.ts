/** A reserved upload: what the desktop said it would send, and what it sent. */
export type StoredSkillUpload = {
  id: string
  ownerId: string
  idempotencyKey: string | null
  expectedArchiveSha256: string
  expectedCompressedBytes: number
  /** Bearer credential for the unauthenticated multipart POST, carried in the policy fields. */
  uploadToken: string
  archive: Buffer | null
  /** Set once finalized; the version the upload became. */
  packageId: string | null
  versionId: string | null
  createdAt: Date
  expiresAt: Date
}

export type StoredSkillPackage = {
  id: string
  ownerId: string
  name: string
  description: string
  createdAt: Date
  deletedAt: Date | null
}

export type StoredSkillVersion = {
  packageId: string
  versionId: string
  name: string
  description: string
  packageDigest: string
  archiveSha256: string
  compressedBytes: number
  releaseNotes: string
  manifest: unknown
  createdAt: Date
  deletedAt: Date | null
}

export type StoredSkillShare = {
  id: string
  packageId: string
  ownerId: string
  pinnedVersionId: string | null
  idempotencyKey: string | null
  createdAt: Date
  revokedAt: Date | null
}

export interface SkillStore {
  migrate(): Promise<void>
  findUpload(id: string): Promise<StoredSkillUpload | undefined>
  findUploadByIdempotencyKey(ownerId: string, key: string): Promise<StoredSkillUpload | undefined>
  insertUpload(upload: StoredSkillUpload): Promise<void>
  updateUpload(upload: StoredSkillUpload): Promise<void>
  findPackage(id: string): Promise<StoredSkillPackage | undefined>
  upsertPackage(skillPackage: StoredSkillPackage): Promise<void>
  /** The package's live versions, newest first. */
  listVersions(packageId: string): Promise<StoredSkillVersion[]>
  findVersion(packageId: string, versionId: string): Promise<StoredSkillVersion | undefined>
  /** Inserts the version with its archive. */
  insertVersion(version: StoredSkillVersion, archive: Buffer): Promise<void>
  updateVersion(version: StoredSkillVersion): Promise<void>
  readArchive(packageId: string, versionId: string): Promise<Buffer | undefined>
  findShare(id: string): Promise<StoredSkillShare | undefined>
  findShareByIdempotencyKey(ownerId: string, key: string): Promise<StoredSkillShare | undefined>
  insertShare(share: StoredSkillShare): Promise<void>
  updateShare(share: StoredSkillShare): Promise<void>
  /** Live shares: the owner's across packages, or one package's. */
  listShares(filter: { ownerId?: string; packageId?: string }): Promise<StoredSkillShare[]>
  close(): Promise<void>
}

/** For tests and a database-less local run. */
export class MemorySkillStore implements SkillStore {
  private readonly uploads = new Map<string, StoredSkillUpload>()
  private readonly packages = new Map<string, StoredSkillPackage>()
  private readonly versions = new Map<string, StoredSkillVersion>()
  private readonly archives = new Map<string, Buffer>()
  private readonly shares = new Map<string, StoredSkillShare>()

  async migrate(): Promise<void> {}

  async findUpload(id: string) {
    const found = this.uploads.get(id)
    return found ? { ...found } : undefined
  }

  async findUploadByIdempotencyKey(ownerId: string, key: string) {
    const found = [...this.uploads.values()].find((upload) => upload.ownerId === ownerId && upload.idempotencyKey === key)
    return found ? { ...found } : undefined
  }

  async insertUpload(upload: StoredSkillUpload) {
    this.uploads.set(upload.id, { ...upload })
  }

  async updateUpload(upload: StoredSkillUpload) {
    this.uploads.set(upload.id, { ...upload })
  }

  async findPackage(id: string) {
    const found = this.packages.get(id)
    return found ? { ...found } : undefined
  }

  async upsertPackage(skillPackage: StoredSkillPackage) {
    this.packages.set(skillPackage.id, { ...skillPackage })
  }

  async listVersions(packageId: string) {
    return [...this.versions.values()]
      .filter((version) => version.packageId === packageId && !version.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((version) => ({ ...version }))
  }

  async findVersion(packageId: string, versionId: string) {
    const found = this.versions.get(`${packageId}/${versionId}`)
    return found ? { ...found } : undefined
  }

  async insertVersion(version: StoredSkillVersion, archive: Buffer) {
    this.versions.set(`${version.packageId}/${version.versionId}`, { ...version })
    this.archives.set(`${version.packageId}/${version.versionId}`, archive)
  }

  async updateVersion(version: StoredSkillVersion) {
    this.versions.set(`${version.packageId}/${version.versionId}`, { ...version })
  }

  async readArchive(packageId: string, versionId: string) {
    return this.archives.get(`${packageId}/${versionId}`)
  }

  async findShare(id: string) {
    const found = this.shares.get(id)
    return found ? { ...found } : undefined
  }

  async findShareByIdempotencyKey(ownerId: string, key: string) {
    const found = [...this.shares.values()].find((share) => share.ownerId === ownerId && share.idempotencyKey === key)
    return found ? { ...found } : undefined
  }

  async insertShare(share: StoredSkillShare) {
    this.shares.set(share.id, { ...share })
  }

  async updateShare(share: StoredSkillShare) {
    this.shares.set(share.id, { ...share })
  }

  async listShares(filter: { ownerId?: string; packageId?: string }) {
    return [...this.shares.values()]
      .filter((share) => !share.revokedAt && (!filter.ownerId || share.ownerId === filter.ownerId) && (!filter.packageId || share.packageId === filter.packageId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((share) => ({ ...share }))
  }

  async close(): Promise<void> {}
}
