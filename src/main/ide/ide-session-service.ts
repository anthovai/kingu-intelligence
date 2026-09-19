/**
 * Owns the single IDE server backing the `ide` view.
 *
 * One server per app, retargeted when the folder changes: the IDE opens the
 * active worktree, and switching worktrees is common enough that a server per
 * worktree would leave several Node processes idling.
 */

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { IdeSessionState } from '../../shared/ide-types'
import { IdeServerStartError, startIdeServer, type IdeServerHandle } from './ide-server-process'
import { admitIdeOrigin, revokeIdeOrigin } from './ide-webview-admission'

type RunningSession = {
  readonly folder: string
  readonly handle: IdeServerHandle
}

let running: RunningSession | null = null
/** Serialises start/stop so two rapid view switches cannot leak a server. */
let pending: Promise<IdeSessionState> | null = null
let idleStopTimer: NodeJS.Timeout | null = null

/**
 * How long a server outlives the view being hidden. Long enough that flipping
 * to the terminal and back is instant, short enough that a session someone
 * left hours ago is not still holding a Node process.
 */
const IDLE_STOP_DELAY_MS = 90_000

/**
 * Returns a ready URL for `folder`, starting or retargeting the server as
 * needed. Never throws: failures come back as an `unavailable` state so the
 * view can explain itself instead of rendering an empty guest.
 */
export async function openIdeSession(folder: string): Promise<IdeSessionState> {
  cancelIdleStop()
  const next = (pending ?? Promise.resolve<IdeSessionState | null>(null))
    .catch(() => null)
    .then(() => resolveSession(folder))
  pending = next
  try {
    return await next
  } finally {
    if (pending === next) {
      pending = null
    }
  }
}

/** Stops the server and revokes its webview admission. Safe to call when idle. */
export async function closeIdeSession(): Promise<void> {
  cancelIdleStop()
  const current = running
  running = null
  revokeIdeOrigin()
  await current?.handle.stop()
}

/**
 * Called when the IDE view stops being shown. The server stays up for a grace
 * period so returning to it is instant; a later `openIdeSession` cancels the
 * stop. Quitting does not wait for this — `closeIdeSession` runs then.
 */
export function releaseIdeSession(): void {
  if (running === null) {
    return
  }
  cancelIdleStop()
  idleStopTimer = setTimeout(() => {
    idleStopTimer = null
    void closeIdeSession()
  }, IDLE_STOP_DELAY_MS)
  // Why unref: a pending stop must never be the reason the process stays alive.
  idleStopTimer.unref?.()
}

function cancelIdleStop(): void {
  if (idleStopTimer !== null) {
    clearTimeout(idleStopTimer)
    idleStopTimer = null
  }
}

async function resolveSession(folder: string): Promise<IdeSessionState> {
  if (running?.folder === folder) {
    return { status: 'ready', url: running.handle.url }
  }
  await closeIdeSession()

  const serverEntry = resolveServerEntry()
  if (!serverEntry) {
    return { status: 'unavailable', reason: 'not-installed' }
  }
  const nodeBinary = resolveNodeBinary()
  if (!nodeBinary) {
    return { status: 'unavailable', reason: 'no-runtime' }
  }

  try {
    const handle = await startIdeServer({
      serverEntry,
      nodeBinary,
      folder,
      serverDataDir: join(app.getPath('userData'), 'ide-server')
    })
    running = { folder, handle }
    admitIdeOrigin(handle.url)
    return { status: 'ready', url: handle.url }
  } catch (error) {
    const detail = error instanceof IdeServerStartError ? error.failure.output : undefined
    return { status: 'unavailable', reason: 'start-failed', detail }
  }
}

/**
 * The packaged IDE build sits beside the app resources. In development, prefer
 * the bundled server distribution over the IDE checkout's `out/`: only the
 * distribution ships bundled web assets, and the unbundled dev tree serves CSS
 * as ES modules, which browsers reject — the workbench never paints.
 * Absent everywhere means the IDE was not bundled.
 */
function resolveServerEntry(): string | null {
  if (app.isPackaged) {
    return firstExisting([join(process.resourcesPath, 'ide', 'out', 'server-main.js')])
  }
  const appPath = app.getAppPath()
  return firstExisting([
    join(appPath, '..', 'vscode-reh-web-win32-x64', 'out', 'server-main.js'),
    join(appPath, '..', '..', 'vscode-reh-web-win32-x64', 'out', 'server-main.js'),
    join(appPath, '..', 'kingu-ide', 'out', 'server-main.js'),
    join(appPath, '..', '..', 'kingu-ide', 'out', 'server-main.js')
  ])
}

function firstExisting(candidates: readonly string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * The server is plain Node, so Electron's own binary can run it with
 * ELECTRON_RUN_AS_NODE — no second runtime has to ship.
 */
function resolveNodeBinary(): string | null {
  return process.execPath || null
}
