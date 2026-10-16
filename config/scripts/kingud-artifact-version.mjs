import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KINGUD_VERSION, kingudArtifactFilenames } from '../../src/shared/kingud-artifacts.ts'

/** The runtime enters through `.runtime-node`'s executableSha256 string, never its bytes (design D2). */
export function computeKingudFullVersion(artifactDir, { target, agentBrowserFilename }) {
  const hash = createHash('sha256')
  for (const filename of kingudArtifactFilenames(target)) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `kingud declares ${filename} in KINGUD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/kingud-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  if (agentBrowserFilename && existsSync(join(artifactDir, agentBrowserFilename))) {
    hash.update(readFileSync(join(artifactDir, agentBrowserFilename)))
  }
  return `${KINGUD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
