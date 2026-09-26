import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'

/**
 * Reads what a skill archive says about itself. The desktop's publish calls
 * carry no names or ids; they are all in the manifest inside the archive
 * (`src/shared/skill-package-manifest.ts`, `skill-bundle-manifest.ts`), which
 * the desktop checks again against the version we return at install time.
 */

export const SKILL_PACKAGE_CONTENT_TYPE = 'application/vnd.kingu.skill+tar+gzip'
export const SKILL_PACKAGE_MAX_COMPRESSED_BYTES = 40 * 1024 * 1024
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024

const BUNDLE_MANIFEST_PATH = 'dev.kingu.skill-sharing/manifest.json'
const PACKAGE_MANIFEST_PATH = 'manifest.json'

const ID = /^[A-Za-z0-9_-]{1,128}$/
const SHA256 = /^[a-f0-9]{64}$/

const fileSchema = z.object({
  path: z.string().min(1).max(1024),
  size: z.number().int().nonnegative().max(4 * 1024 * 1024),
  executable: z.boolean(),
  classification: z.enum(['text', 'binary']),
  sha256: z.string().regex(SHA256),
  identitySha256: z.string().regex(SHA256)
}).strict()

const packageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: z.string().regex(ID),
  versionId: z.string().regex(ID),
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  description: z.string().max(4096),
  createdAt: z.string().datetime({ offset: true }),
  files: z.array(fileSchema).min(1).max(512),
  packageDigest: z.string().regex(SHA256)
}).strict()

const bundleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageId: z.string().regex(ID),
  versionId: z.string().regex(ID),
  bundleName: z.string().min(1).max(64).regex(/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/),
  description: z.string().max(4096),
  createdAt: z.string().datetime({ offset: true }),
  skills: z.array(z.object({
    id: z.string().regex(ID),
    name: z.string(),
    description: z.string().max(4096),
    digest: z.string().regex(SHA256),
    files: z.array(fileSchema).min(1).max(512)
  }).strict()).min(1).max(512),
  bundleDigest: z.string().regex(SHA256)
}).strict()

/** What a version is, as read from its archive. */
export type SkillArchiveIdentity = {
  packageId: string
  versionId: string
  name: string
  description: string
  /** `packageDigest`, or a bundle's `bundleDigest`, as the desktop's version preview reads it. */
  packageDigest: string
  manifest: z.infer<typeof packageManifestSchema> | z.infer<typeof bundleManifestSchema>
}

export class SkillArchiveError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function readString(header: Buffer, offset: number, length: number): string {
  const field = header.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? field.length : end).toString('utf8')
}

/** The ustar entries the desktop's `writeSkillTarGzip` writes: name + prefix, no pax headers. */
function findEntry(tar: Buffer, wanted: readonly string[]): { path: string; bytes: Buffer } | undefined {
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      return undefined
    }
    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(readString(header, 124, 12).trim() || '0', 8)
    if (!Number.isFinite(size) || size < 0) {
      throw new SkillArchiveError('skill_archive_invalid', 'The skill archive is not a valid tar file.')
    }
    const start = offset + 512
    if (wanted.includes(path)) {
      if (size > MAX_MANIFEST_BYTES || start + size > tar.length) {
        throw new SkillArchiveError('skill_archive_invalid', 'The skill manifest is too large or truncated.')
      }
      return { path, bytes: tar.subarray(start, start + size) }
    }
    offset = start + Math.ceil(size / 512) * 512
  }
  return undefined
}

/**
 * The version an archive holds, validated the way the desktop validates it
 * (schema and digest), so a version we serve always installs.
 */
export function readSkillArchive(archive: Buffer): SkillArchiveIdentity {
  let tar: Buffer
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_UNCOMPRESSED_BYTES })
  } catch {
    throw new SkillArchiveError('skill_archive_invalid', 'The skill archive is not valid gzip or is too large.')
  }
  const entry = findEntry(tar, [BUNDLE_MANIFEST_PATH, PACKAGE_MANIFEST_PATH])
  if (!entry) {
    throw new SkillArchiveError('skill_manifest_missing', 'The skill archive has no manifest.')
  }
  let json: unknown
  try {
    json = JSON.parse(entry.bytes.toString('utf8'))
  } catch {
    throw new SkillArchiveError('skill_manifest_invalid', 'The skill manifest is not valid JSON.')
  }
  if (entry.path === BUNDLE_MANIFEST_PATH) {
    const parsed = bundleManifestSchema.safeParse(json)
    if (!parsed.success) {
      throw new SkillArchiveError('skill_manifest_invalid', parsed.error.issues[0]?.message ?? 'The skill bundle manifest is invalid.')
    }
    const manifest = parsed.data
    if (sha256(JSON.stringify(manifest.skills.map(({ id, name, digest }) => ({ id, name, digest })))) !== manifest.bundleDigest) {
      throw new SkillArchiveError('skill_manifest_invalid', 'The skill bundle digest does not match its skills.')
    }
    return { packageId: manifest.packageId, versionId: manifest.versionId, name: manifest.bundleName, description: manifest.description, packageDigest: manifest.bundleDigest, manifest }
  }
  const parsed = packageManifestSchema.safeParse(json)
  if (!parsed.success) {
    throw new SkillArchiveError('skill_manifest_invalid', parsed.error.issues[0]?.message ?? 'The skill manifest is invalid.')
  }
  const manifest = parsed.data
  const digest = sha256(JSON.stringify(manifest.files.map(({ path, executable, classification, identitySha256 }) => ({ path, executable, classification, identitySha256 }))))
  if (digest !== manifest.packageDigest) {
    throw new SkillArchiveError('skill_manifest_invalid', 'The skill package digest does not match its files.')
  }
  return { packageId: manifest.packageId, versionId: manifest.versionId, name: manifest.name, description: manifest.description, packageDigest: manifest.packageDigest, manifest }
}
