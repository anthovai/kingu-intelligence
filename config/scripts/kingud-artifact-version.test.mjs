import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  KINGUD_BUILD_TARGET_FILENAME,
  KINGUD_RIPGREP_ARTIFACTS,
  kingudArtifactFilenames
} from '../../src/shared/kingud-artifacts.ts'
import { KINGUD_BUN_TARGETS } from '../../src/shared/kingud-bun-runtime.ts'
import { kingudAgentBrowserNativeName } from '../../src/shared/kingud-agent-browser-name.ts'
import { readKingudArtifactIdentity } from '../../src/main/kingud/kingud-artifact-identity.ts'
import { computeKingudFullVersion } from './kingud-artifact-version.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createArtifactDirectory(target = '') {
  const directory = mkdtempSync(join(tmpdir(), 'kingud-version-'))
  directories.push(directory)
  for (const filename of kingudArtifactFilenames(target)) {
    const path = join(directory, filename)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, filename)
  }
  writeFileSync(join(directory, KINGUD_BUILD_TARGET_FILENAME), `${target}\n`)
  return directory
}

describe('standalone runtime version', () => {
  it('changes when a shipped search binary changes and rejects a missing binary', () => {
    const dir = createArtifactDirectory()
    const before = computeKingudFullVersion(dir)
    const binary = join(dir, KINGUD_RIPGREP_ARTIFACTS[0])
    writeFileSync(binary, 'updated binary')
    expect(computeKingudFullVersion(dir)).not.toBe(before)
    rmSync(binary)
    expect(() => computeKingudFullVersion(dir)).toThrow(KINGUD_RIPGREP_ARTIFACTS[0])
  })

  it.each(KINGUD_BUN_TARGETS)(
    'matches the installed %s identity with and without its optional browser',
    async (target) => {
      const dir = createArtifactDirectory(target)
      const [platform, arch] = target.split('-')
      const agentBrowserFilename = kingudAgentBrowserNativeName(
        platform,
        arch,
        target.endsWith('-musl') ? 'musl' : 'glibc'
      )
      const options = { target, agentBrowserFilename }
      const withoutBrowser = computeKingudFullVersion(dir, options)
      expect(withoutBrowser).toBe(await readKingudArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'browser')
      const withBrowser = computeKingudFullVersion(dir, options)
      expect(withBrowser).not.toBe(withoutBrowser)
      expect(withBrowser).toBe(await readKingudArtifactIdentity(dir))
      writeFileSync(join(dir, agentBrowserFilename), 'updated-browser')
      expect(computeKingudFullVersion(dir, options)).not.toBe(withBrowser)
      expect(computeKingudFullVersion(dir, options)).toBe(await readKingudArtifactIdentity(dir))
    }
  )
})
