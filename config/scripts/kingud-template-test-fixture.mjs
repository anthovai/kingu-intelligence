import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  KINGUD_BUILD_TARGET_FILENAME,
  KINGUD_TEMPLATE_MANIFEST_FILENAME,
  KINGUD_TEMPLATE_TARGETS_DIR,
  kingudTemplateCommonFilenames
} from '../../src/shared/kingud-artifacts.ts'
import { KINGUD_TEMPLATE_TARGETS } from '../../src/shared/kingud-bun-runtime.ts'

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
  return createHash('sha256').update(contents).digest('hex')
}

export async function writeKingudTemplateTestFixture(resourcesDir) {
  const templateDir = join(resourcesDir, 'kingud-template')
  const commonFilenames = kingudTemplateCommonFilenames()
  const commonSha256 = {}
  for (const filename of commonFilenames) {
    commonSha256[filename] = await write(
      join(templateDir, ...filename.split('/')),
      Buffer.from(`common:${filename}`)
    )
  }
  const targets = {}
  for (const target of KINGUD_TEMPLATE_TARGETS) {
    const targetDir = join(templateDir, KINGUD_TEMPLATE_TARGETS_DIR, target)
    targets[target] = {
      targetSha256: await write(join(targetDir, KINGUD_BUILD_TARGET_FILENAME), `${target}\n`),
      watcherSha256: await write(join(targetDir, 'watcher.node'), `watcher:${target}`)
    }
  }
  const browserName = 'agent-browser-linux-x64'
  targets['linux-x64-glibc'] = {
    ...targets['linux-x64-glibc'],
    browserName,
    browserSha256: await write(
      join(templateDir, KINGUD_TEMPLATE_TARGETS_DIR, 'linux-x64-glibc', browserName),
      'browser'
    )
  }
  await writeFile(
    join(templateDir, KINGUD_TEMPLATE_MANIFEST_FILENAME),
    JSON.stringify({ schemaVersion: 2, commonSha256, targets })
  )
  return templateDir
}
