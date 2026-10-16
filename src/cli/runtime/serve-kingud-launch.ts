/**
 * `kingu serve` on this machine's kingud slot. Whether to (and the slot itself) is decided
 * app-side by `src/main/kingud/kingud-local-serve-selection.ts`; the CLI only asks and runs.
 */
import { dirname, join } from 'node:path'
import { runProcess, spawnProcess } from '@kingu/process-host'
import type { ProcessSpec } from '@kingu/process-host/process-spec'
import {
  KINGUD_LOCAL_SERVE_SELECTION_ENTRY,
  KINGUD_LOCAL_SERVE_SELECTION_FLAGS as FLAGS,
  parseServeRuntimeSelection,
  type ServeRuntimeSelection
} from '../../shared/kingud-local-serve-selection'
import { waitForRecipeJson } from './serve-recipe-json'
import { superviseForegroundServe } from './serve-update-supervisor'
import { isSupervisedSpawnHeld } from './serve-supervised-stop'
import { redactingSpawn, shouldRedactSupervisedStdout } from './serve-pairing-redaction'

export type ServeKinguAppArgs = {
  json?: boolean
  port?: string | null
  pairingAddress?: string | null
  noPairing?: boolean
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  recipeJson?: boolean
  projectRoot?: string | null
  /** Starts Electron serve despite a remembered macOS startup abort in this environment. */
  force?: boolean
  /** Restart the server under a service manager instead of exiting with it; never inferred. */
  supervise?: boolean
}

/** A first run may download and verify the pinned Node; bound it well past that. */
const SELECTION_TIMEOUT_MS = 10 * 60_000

/** Asks the app's own entry, run on the app's executable as plain Node, which host to serve on. */
export async function resolveLocalServeRuntime(
  options: {
    executable: string
    appRoot: string
    userDataPath: string
    usesMacUpdateHandoff: boolean
  },
  run: typeof runProcess = runProcess
): Promise<ServeRuntimeSelection> {
  // Why: only packaged macOS serve can take a remote app update, through Electron's updater and
  // this CLI's supervisor; kingud has no updater, so switching would drop that.
  if (options.usesMacUpdateHandoff) {
    return {
      kind: 'electron',
      reason:
        'packaged macOS serve stays on Electron so paired clients can still update it (kingud has no app updater)'
    }
  }
  const entry = join(options.appRoot, 'out', 'main', `${KINGUD_LOCAL_SERVE_SELECTION_ENTRY}.js`)
  try {
    const result = await run({
      program: options.executable,
      args: [entry, FLAGS.userData, options.userDataPath, FLAGS.appRoot, options.appRoot],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // Why inherit stderr: a first run may download the pinned Node, and that progress is the
      // only sign `kingu serve` is not hung.
      stdio: ['ignore', 'pipe', 'inherit'],
      timeoutMs: SELECTION_TIMEOUT_MS
    })
    return (
      parseServeRuntimeSelection(result.stdout) ?? {
        kind: 'electron',
        reason: `the app did not answer which serve host to use (exit ${String(result.code)})`
      }
    )
  } catch (error) {
    return {
      kind: 'electron',
      reason: `the app could not check kingud: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** Electron serve binds every interface (`exposeNetworkByDefault`); kingud does it on request. */
export function serveWithKingud(
  selection: Extract<ServeRuntimeSelection, { kind: 'kingud' }>,
  args: ServeKinguAppArgs,
  userDataPath: string,
  /** The caller's environment without `ELECTRON_RUN_AS_NODE`. */
  baseEnv: NodeJS.ProcessEnv
): Promise<number> {
  const spec: ProcessSpec = {
    program: selection.runtime,
    args: [selection.entry, ...kingudServeArgs(args)],
    detached: args.recipeJson === true,
    cwd: dirname(selection.entry),
    stdio: args.recipeJson === true ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: {
      ...baseEnv,
      // The desktop's profile: its instance lock makes the two refuse each other.
      KINGU_USER_DATA: userDataPath,
      KINGU_VERSION: selection.version
    }
  }
  const spawnChild = shouldRedactSupervisedStdout(args.supervise === true)
    ? redactingSpawn(spawnProcess)
    : spawnProcess
  if (isSupervisedSpawnHeld()) {
    return Promise.resolve(0)
  }
  const child = spawnChild(spec)
  if (args.recipeJson) {
    return waitForRecipeJson(child)
  }
  return superviseForegroundServe({
    spec,
    spawnChild,
    child,
    handoffPath: null,
    expectedHandoff: null
  })
}

export function serveOptionArgs(args: ServeKinguAppArgs, prefix: '--' | '--serve-'): string[] {
  return [
    ...(args.json ? [`${prefix}json`] : []),
    ...(args.port ? [`${prefix}port`, args.port] : []),
    ...(args.pairingAddress ? [`${prefix}pairing-address`, args.pairingAddress] : []),
    ...(args.noPairing ? [`${prefix}no-pairing`] : []),
    ...(args.mobilePairing ? [`${prefix}mobile-pairing`] : []),
    ...(args.grantDesktopControl ? [`${prefix}grant-desktop-control`] : []),
    ...(args.recipeJson && args.projectRoot
      ? [`${prefix}recipe-json`, `${prefix}project-root`, args.projectRoot]
      : [])
  ]
}

export function kingudServeArgs(args: ServeKinguAppArgs): string[] {
  return ['--bind', '0.0.0.0', ...serveOptionArgs(args, '--')]
}
