import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  KINGUD_NODE_RUNTIME_MARKER_FILENAME,
  KINGUD_SERVER_TARGET_FILENAME,
  KINGUD_TEMPLATE_MANIFEST_FILENAME,
  KINGUD_TEMPLATE_TARGETS_DIR,
  kingudTemplateCommonFilenames,
  kingudTemplateTargetFilenames
} from '../../src/shared/kingud-artifacts.ts'
import {
  COMPAT_SERVER_TARGETS,
  KINGUD_TEMPLATE_TARGETS,
  pinnedNodeRuntimeAsset
} from '../../src/shared/node-runtime-pin.ts'

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
  return createHash('sha256').update(contents).digest('hex')
}

function targetFileContents(target, filename) {
  if (filename === KINGUD_SERVER_TARGET_FILENAME) {
    return `${target}\n`
  }
  if (filename === KINGUD_NODE_RUNTIME_MARKER_FILENAME) {
    return `${pinnedNodeRuntimeAsset(target).executableSha256}\n`
  }
  return `${target}:${filename}`
}

export async function writeKingudTemplateTestFixture(resourcesDir, { compat = false } = {}) {
  const templateDir = join(resourcesDir, 'kingud-template')
  const commonSha256 = {}
  for (const filename of kingudTemplateCommonFilenames()) {
    commonSha256[filename] = await write(
      join(templateDir, ...filename.split('/')),
      Buffer.from(`common:${filename}`)
    )
  }
  const targets = {}
  for (const target of [...KINGUD_TEMPLATE_TARGETS, ...(compat ? COMPAT_SERVER_TARGETS : [])]) {
    const targetDir = join(templateDir, KINGUD_TEMPLATE_TARGETS_DIR, target)
    const files = {}
    for (const filename of kingudTemplateTargetFilenames(target)) {
      files[filename] = await write(
        join(targetDir, ...filename.split('/')),
        targetFileContents(target, filename)
      )
    }
    targets[target] = { files }
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
    JSON.stringify({ schemaVersion: 3, commonSha256, targets })
  )
  return templateDir
}
