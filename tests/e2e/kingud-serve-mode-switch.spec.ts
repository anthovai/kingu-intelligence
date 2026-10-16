/**
 * D7 across a real `kingu serve` host switch: a terminal opened under Electron serve survives a
 * switch to kingud serve on the same profile (same daemon adopted, terminal reattached) and back,
 * and a terminal kingud's daemon owns survives a switch to Electron serve. Also the shared-profile
 * lock: each host refuses to serve a profile the other holds.
 *
 * Needs the packaged kingud slot (`pnpm build:kingud`). Background launch only; nothing is focused.
 *
 * Run:
 *   KINGU_E2E_KINGUD_SERVE=1 KINGU_BACKGROUND_LAUNCH=1 pnpm exec playwright test \
 *     tests/e2e/kingud-serve-mode-switch.spec.ts --config tests/playwright.config.ts \
 *     --project electron-headless --workers=1
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runProcess } from '@kingu/process-host'
import { getDaemonPidPath } from '../../src/main/daemon/daemon-spawner'
import { readDaemonPidRecord } from '../../src/main/daemon/daemon-endpoint-incarnation'
import { resolveBundledKingudRuntime } from '../../src/main/kingud/kingud-bundled-runtime'
import { KINGUD_EXIT_CONFIGURATION } from '../../src/main/kingud/kingud-configuration-exit'
import {
  buildDaemonSessionClient,
  type DaemonSessionClientResult
} from '../../src/main/kingud/kingud-daemon-session-client-fixture'
import { expect, test } from './helpers/kingu-app'
import { resolveElectronExecutable } from './helpers/daemon-generation-runtime-fixture'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { cleanupE2EDaemons } from './helpers/electron-process-shutdown'
import {
  cliServeProfile,
  isPidAlive,
  spawnUntilReady,
  startCliServe
} from './helpers/kingu-serve-cli-host'

const RUN = process.env.KINGU_E2E_KINGUD_SERVE === '1'
const slotDir = path.resolve('out/kingud')
const kingudRuntime = RUN && existsSync(slotDir) ? resolveBundledKingudRuntime(slotDir) : null
const SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE = 3

test.describe.configure({ mode: 'serial' })

let scratch = ''
let clientScript = ''

test.beforeAll(async () => {
  test.skip(
    !RUN,
    'Set KINGU_E2E_KINGUD_SERVE=1 (and build out/kingud) to run the serve mode switch.'
  )
  expect(kingudRuntime, 'pnpm build:kingud must produce a packaged slot in out/kingud').toBeTruthy()
  // Short root: macOS caps a unix socket path at 104 bytes, and the daemon's lives in userData.
  scratch = mkdtempSync(path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'kingu-d7-'))
  clientScript = path.join(scratch, 'daemon-client.cjs')
  await buildDaemonSessionClient(clientScript)
})

test.afterAll(() => {
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 })
  }
})

function daemonPid(userDataDir: string): number | null {
  return readDaemonPidRecord(getDaemonPidPath(path.join(userDataDir, 'daemon')))?.pid ?? null
}

/** A paired client's terminal, straight to the profile's daemon, under this runner's Node. */
async function terminal(
  host: HeadlessPairedRuntimeHost,
  op: 'create' | 'attach',
  marker: string
): Promise<DaemonSessionClientResult> {
  const result = await runProcess({
    program: process.execPath,
    args: [clientScript, op, path.join(host.userDataDir, 'daemon'), 'serve-d7', marker, scratch],
    env: host.env,
    timeoutMs: 30_000
  })
  expect(result.code, result.stderr).toBe(0)
  return JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')
}

type KingudServe = { daemonPid: number; stop: () => Promise<void> }

/** `kingu serve` on kingud, as the T6-11 launcher runs it, on the host's own profile. */
async function startKingudServe(
  host: Pick<HeadlessPairedRuntimeHost, 'env' | 'userDataDir'>
): Promise<KingudServe> {
  const serve = await spawnUntilReady({
    label: 'kingud serve',
    program: kingudRuntime!,
    args: [path.join(slotDir, 'kingud.js'), '--bind', '127.0.0.1', '--port', '0', '--json'],
    env: { ...host.env, KINGU_USER_DATA: host.userDataDir },
    timeoutMs: 120_000,
    parseReady: (stdout) => {
      const newline = stdout.indexOf('\n')
      return newline === -1 ? null : stdout.slice(0, newline)
    }
  })
  try {
    const daemon = JSON.parse(serve.ready).health?.terminalDaemon
    expect(daemon?.state, serve.stderr()).toBe('live')
    // POSIX: SIGTERM is kingud's graceful stop and leaves the daemon running by design.
    return { daemonPid: daemon.pid, stop: serve.stop }
  } catch (error) {
    // Why: the caller never gets stop(), and a leaked kingud keeps the profile lock.
    await serve.stop()
    throw error
  }
}

// Why: an SSH-managed kingud on this machine runs under ~/.kingu, beside the desktop's own profile.
test("Electron serve starts beside a live daemon another profile's kingud forked", async () => {
  const other = cliServeProfile(scratch)
  const kingud = await startKingudServe(other)
  try {
    const host = await launchHeadlessPairedRuntimeHost({
      pinnedServePort: true,
      userDataParent: scratch
    })
    try {
      expect(daemonPid(host.userDataDir)).not.toBe(kingud.daemonPid)
    } finally {
      await host.dispose()
    }
  } finally {
    await kingud.stop()
    await cleanupE2EDaemons(other.userDataDir)
  }
})

test('a terminal survives Electron serve → kingud serve → Electron serve on one profile', async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    const created = await terminal(host, 'create', 'ELECTRON')
    expect(created).toMatchObject({ isReattach: false, output: true })
    const electronDaemon = daemonPid(host.userDataDir)
    expect(electronDaemon).toBeTruthy()

    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Electron serve has quit; kingud serve takes the same profile and adopts its daemon.
        const kingud = await startKingudServe(host)
        try {
          expect(kingud.daemonPid).toBe(electronDaemon)
          expect(await terminal(host, 'attach', 'KINGUD')).toEqual({
            pid: created.pid,
            isReattach: true,
            output: true
          })
        } finally {
          await kingud.stop()
        }
      }
    })

    // Back on Electron serve: still the same daemon and the same live terminal.
    expect(daemonPid(host.userDataDir)).toBe(electronDaemon)
    expect(await terminal(host, 'attach', 'BACK')).toEqual({
      pid: created.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})

test("Electron serve adopts a terminal kingud's daemon owns", async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    let created: DaemonSessionClientResult | null = null
    let kingudDaemon: number | null = null
    await host.restartServeProcess({
      betweenProcesses: async () => {
        // Retire Electron's daemon so kingud serve forks its own on the pinned Node.
        const previous = daemonPid(host.userDataDir)
        if (previous) {
          process.kill(previous, 'SIGKILL')
          await expect.poll(() => isPidAlive(previous), { timeout: 10_000 }).toBe(false)
        }
        const kingud = await startKingudServe(host)
        try {
          kingudDaemon = kingud.daemonPid
          expect(kingudDaemon).not.toBe(previous)
          created = await terminal(host, 'create', 'KINGUD')
          expect(created).toMatchObject({ isReattach: false, output: true })
        } finally {
          await kingud.stop()
        }
      }
    })
    expect(daemonPid(host.userDataDir)).toBe(kingudDaemon)
    expect(await terminal(host, 'attach', 'ELECTRON')).toEqual({
      pid: created!.pid,
      isReattach: true,
      output: true
    })
  } finally {
    await host.dispose()
  }
})

test('each serve host refuses a profile the other holds', async () => {
  const host = await launchHeadlessPairedRuntimeHost({
    pinnedServePort: true,
    userDataParent: scratch
  })
  try {
    // Electron serve holds the profile: kingud serve refuses with its configuration exit code.
    const refused = await runProcess({
      program: kingudRuntime!,
      args: [path.join(slotDir, 'kingud.js'), '--bind', '127.0.0.1', '--port', '0', '--json'],
      env: { ...host.env, KINGU_USER_DATA: host.userDataDir },
      timeoutMs: 60_000
    })
    expect(refused.code).toBe(KINGUD_EXIT_CONFIGURATION)
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain('The Kingu desktop app')

    await host.restartServeProcess({
      betweenProcesses: async () => {
        // kingud serve holds it: an Electron launch on the same profile exits as a duplicate.
        const kingud = await startKingudServe(host)
        try {
          const electron = await runProcess({
            program: resolveElectronExecutable(process.cwd()),
            args: [...host.electronArgs, '--serve', '--serve-json', '--serve-port', '0'],
            env: host.env,
            timeoutMs: 90_000
          })
          expect(electron.code).toBe(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE)
          expect(`${electron.stdout}${electron.stderr}`).toContain('Another kingud')
        } finally {
          await kingud.stop()
        }
      }
    })
  } finally {
    await host.dispose()
  }
})

/** Which host holds the profile: both take `kingud.lock`, each under its own role. */
function profileLockRole(userDataDir: string): unknown {
  return JSON.parse(readFileSync(path.join(userDataDir, 'kingud.lock'), 'utf8')).role
}

// Needs out/kingud-template for this runner's target, as a packaged install carries.
test('`kingu serve` runs on kingud by default and on Electron with KINGU_SERVE_RUNTIME=electron', async () => {
  const profile = cliServeProfile(scratch)
  try {
    const byDefault = await startCliServe(profile)
    try {
      expect(byDefault.stderr()).toContain('[serve] running on kingud')
      expect(byDefault.readiness.health).toBeDefined()
      expect(profileLockRole(profile.userDataDir)).toBe('kingud')
    } finally {
      await byDefault.stop()
    }

    // Electron serve publishes no build-health block yet, which is what tells the two apart.
    const electron = await startCliServe(profile, { KINGU_SERVE_RUNTIME: 'electron' })
    try {
      expect(electron.stderr()).not.toContain('[serve] running on kingud')
      expect(electron.readiness.health).toBeUndefined()
    } finally {
      await electron.stop()
    }
  } finally {
    await cleanupE2EDaemons(profile.userDataDir)
  }
})
