// Runs the headless-server suites under the pinned Node (design D4/D4a), not the host's.
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { globSync, readFileSync } from 'node:fs'
import {
  KINGUD_CLI_ENTRY_FILENAME,
  KINGUD_SERVER_ENTRY_FILENAME,
  KINGUD_VERSION_FILENAME
} from '../../src/shared/kingud-artifacts.ts'
import { NODE_RUNTIME_PIN } from '../../src/shared/node-runtime-pin.ts'
import {
  KINGUD_PROFILE_PREFLIGHT_FLAG,
  parseKingudProfilePreflight
} from '../../src/shared/kingud-profile-preflight.ts'
import { packagedNodeRuntimePath } from './build-kingud-node.mjs'
import { ensurePinnedNodeExecutable } from './pinned-node-downloads.mjs'
import { currentTarget } from './server-build-target.mjs'
import { UNIT_INCLUDE } from './ci-unit-files.mjs'
import { runProcessSync } from '@kingu/process-host'
import { describeProcessFailure } from './process-failure-message.mjs'
import { resolveBuildSourceCommit } from './build-source-commit.mjs'
import {
  CROSS_RUNTIME_TEST_PATHS,
  nodeServerTestPaths,
  REQUIRED_TEST_INPUTS_ENV
} from './node-server-test-paths.mjs'

const root = resolve(import.meta.dirname, '../..')
const target = currentTarget()
const artifact = process.argv.includes('--artifact')
// Lanes that provide the pinned Bun and the last Bun kingud slot (design D7 upgrade and rollback).
const crossRuntime = process.argv.includes('--cross-runtime')
const testArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== '--artifact' && arg !== '--cross-runtime')
const packageDir = join(root, 'out', 'kingud')
const runtimePath = artifact
  ? packagedNodeRuntimePath(packageDir, target)
  : await ensurePinnedNodeExecutable({ target })
// Tests that launch the packaged runtime themselves find it here. A lane's named inputs are
// required: their tests fail on a missing input instead of passing as a skip.
const env = {
  ...process.env,
  KINGU_BACKGROUND_LAUNCH: '1',
  KINGU_PINNED_NODE: runtimePath,
  [REQUIRED_TEST_INPUTS_ENV]: [artifact && 'artifact', crossRuntime && 'cross-runtime']
    .filter(Boolean)
    .join(',')
}

function run(program, args) {
  const result = runProcessSync({
    program,
    args,
    cwd: root,
    env,
    stdio: 'inherit',
    timeoutMs: null
  })
  if (result.code !== 0) {
    process.exit(result.code ?? 1)
  }
}

if (artifact) {
  const nonce = randomUUID()
  const result = runProcessSync({
    program: runtimePath,
    args: [join(packageDir, KINGUD_SERVER_ENTRY_FILENAME), KINGUD_PROFILE_PREFLIGHT_FLAG, nonce],
    cwd: root,
    env,
    timeoutMs: 90_000
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    throw new Error(`Bundled runtime readiness failed: ${describeProcessFailure(result)}`)
  }
  const response = parseKingudProfilePreflight(
    result.stdout,
    nonce,
    { runtime: 'node', runtimeVersion: NODE_RUNTIME_PIN.version },
    readFileSync(join(packageDir, KINGUD_VERSION_FILENAME), 'utf8').trim()
  )
  process.stdout.write(`${JSON.stringify({ target, ...response })}\n`)

  const source = `https://github.com/anthovai/kingu-intelligence/tree/${resolveBuildSourceCommit()}`
  const cli = runProcessSync({
    program: runtimePath,
    args: [
      join(packageDir, KINGUD_CLI_ENTRY_FILENAME),
      'skills',
      'install',
      '--skill',
      'kingu-cli',
      '--agent',
      'universal',
      '--dry-run'
    ],
    cwd: root,
    env,
    timeoutMs: 90_000
  })
  if (
    cli.code !== 0 ||
    cli.timedOut ||
    cli.outputTruncated ||
    !cli.stdout.split('\n')[0].split(' ').includes(source)
  ) {
    throw new Error(
      `Bundled CLI skills source did not match ${source}: ${describeProcessFailure(cli)}`
    )
  }
}
run(runtimePath, [
  join(root, 'node_modules/vitest/vitest.mjs'),
  'run',
  '--config',
  'config/vitest.config.ts',
  ...(testArgs.length > 0 ? testArgs : defaultTestArgs())
])

function defaultTestArgs() {
  // Why: vitest 5 drops CLI --exclude for inline projects, so the selectors' substring matches
  // are resolved to files here and filtered before vitest sees them.
  // Electron probes run in desktop jobs; headless compatibility containers have no display.
  const selectors = nodeServerTestPaths({ artifact, crossRuntime })
  const skipped = new Set(crossRuntime ? [] : CROSS_RUNTIME_TEST_PATHS)
  return globSync(UNIT_INCLUDE, { cwd: root })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => selectors.some((selector) => path.includes(selector)))
    .filter((path) => !path.endsWith('.electron.test.ts') && !skipped.has(path))
    .sort()
}
