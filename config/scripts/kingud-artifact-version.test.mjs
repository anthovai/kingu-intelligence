import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  KINGUD_NODE_RUNTIME_MARKER_FILENAME,
  KINGUD_SERVER_TARGET_FILENAME,
  kingudArtifactFilenames,
  kingudRipgrepArtifact
} from '../../src/shared/kingud-artifacts.ts'
import { SERVER_TARGETS } from '../../src/shared/node-runtime-pin.ts'
import { kingudAgentBrowserNativeName } from '../../src/shared/kingud-agent-browser-name.ts'
import { readKingudArtifactIdentity } from '../../src/main/kingud/kingud-artifact-identity.ts'
import { computeKingudFullVersion } from './kingud-artifact-version.mjs'

const directories = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function createArtifactDirectory(target = 'linux-x64-glibc') {
  const directory = mkdtempSync(join(tmpdir(), 'kingud-version-'))
  directories.push(directory)
  for (const filename of kingudArtifactFilenames(target)) {
    const path = join(directory, filename)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, filename)
  }
  writeFileSync(join(directory, KINGUD_SERVER_TARGET_FILENAME), `${target}\n`)
  return directory
}

describe('standalone runtime version', () => {
  it('changes when a shipped search binary changes and rejects a missing binary', () => {
    const target = 'linux-x64-glibc'
    const dir = createArtifactDirectory(target)
    const before = computeKingudFullVersion(dir, { target })
    const binary = join(dir, kingudRipgrepArtifact(target))
    writeFileSync(binary, 'updated binary')
    expect(computeKingudFullVersion(dir, { target })).not.toBe(before)
    rmSync(binary)
    expect(() => computeKingudFullVersion(dir, { target })).toThrow(kingudRipgrepArtifact(target))
  })

  it('keys the version on the referenced runtime digest rather than its bytes', () => {
    const target = 'darwin-arm64'
    const dir = createArtifactDirectory(target)
    writeFileSync(join(dir, KINGUD_NODE_RUNTIME_MARKER_FILENAME), `${'a'.repeat(64)}\n`)
    const before = computeKingudFullVersion(dir, { target })
    writeFileSync(join(dir, KINGUD_NODE_RUNTIME_MARKER_FILENAME), `${'b'.repeat(64)}\n`)
    expect(computeKingudFullVersion(dir, { target })).not.toBe(before)
  })

  it.each(SERVER_TARGETS)(
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
