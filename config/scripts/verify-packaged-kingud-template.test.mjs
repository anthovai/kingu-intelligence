import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  KINGUD_TEMPLATE_MANIFEST_FILENAME,
  KINGUD_TEMPLATE_TARGETS_DIR
} from '../../src/shared/kingud-artifacts.ts'
import { writeKingudTemplateTestFixture } from './kingud-template-test-fixture.mjs'

const require = createRequire(import.meta.url)
const { verifyPackagedKingudTemplate } = require('./verify-packaged-kingud-template.cjs')
const builderConfig = require('../electron-builder.config.cjs')
const roots = []

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'kingu-packaged-kingud-template-'))
  roots.push(root)
  const templateDir = await writeKingudTemplateTestFixture(root)
  return { root, templateDir }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('verifyPackagedKingudTemplate', () => {
  it('accepts the exact six-target packaged template', async () => {
    const fixture = await createFixture()

    expect(() => verifyPackagedKingudTemplate(fixture.root)).not.toThrow()
  })

  it('rejects target-native bytes changed after manifest generation', async () => {
    const fixture = await createFixture()
    await writeFile(
      join(fixture.templateDir, KINGUD_TEMPLATE_TARGETS_DIR, 'linux-x64-glibc', 'watcher.node'),
      'mutated'
    )

    expect(() => verifyPackagedKingudTemplate(fixture.root)).toThrow(
      'linux-x64-glibc watcher checksum mismatch'
    )
  })

  it('rejects a missing Windows PTY gate worker', async () => {
    const fixture = await createFixture()
    await rm(join(fixture.templateDir, 'windows-bun-pty-gate-entry.js'))

    expect(() => verifyPackagedKingudTemplate(fixture.root)).toThrow(
      'windows-bun-pty-gate-entry.js'
    )
  })

  it.each(['writer', 'backup'])(
    'requires the profile %s worker and its exact bytes',
    async (role) => {
      const fixture = await createFixture()
      const filename = `profile-state-${role}-worker-entry.js`
      await writeFile(join(fixture.templateDir, filename), 'stale-worker')
      expect(() => verifyPackagedKingudTemplate(fixture.root)).toThrow(
        `${filename} checksum mismatch`
      )
      await rm(join(fixture.templateDir, filename))
      expect(() => verifyPackagedKingudTemplate(fixture.root)).toThrow(`missing ${filename}`)
    }
  )

  it('rejects a missing target before the package reaches deployment', async () => {
    const fixture = await createFixture()
    const manifestPath = join(fixture.templateDir, KINGUD_TEMPLATE_MANIFEST_FILENAME)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.targets['linux-arm64-musl']
    await writeFile(manifestPath, JSON.stringify(manifest))

    expect(() => verifyPackagedKingudTemplate(fixture.root)).toThrow(
      'target manifest inventory mismatch'
    )
  })

  it('does not ship the unused deployment template in desktop packages', async () => {
    for (const platform of ['win', 'mac', 'linux']) {
      expect(
        builderConfig[platform].extraResources.some(
          (resource) => typeof resource === 'object' && resource.to.startsWith('kingud-template')
        )
      ).toBe(false)
    }
    const { scripts } = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'))
    for (const name of ['build:desktop', 'build:release', 'build:release:parallel']) {
      expect(scripts[name]).not.toContain('build:kingud-template')
    }
  })
})
