/**
 * Supervises the bundled Kingu IDE server (a VS Code server build) that backs
 * the `ide` top-level view. The renderer loads its URL in a guest webview, so
 * this only owns process lifetime, port discovery and readiness.
 *
 * The server binds loopback with a connection token; both are required before
 * the URL is handed to the renderer.
 */

import { randomBytes } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawnProcess } from '../../shared/child-process/run-process'

/** Emitted by the server once it accepts connections. */
const LISTENING_PATTERN = /Web UI available at (\S+)/

export type IdeServerSpec = {
  /** Absolute path to the server entry (`out/server-main.js` in the IDE build). */
  readonly serverEntry: string
  /** Absolute path to the Node binary that runs the server. */
  readonly nodeBinary: string
  /** Folder the IDE opens — the active worktree's path. */
  readonly folder: string
  /** Where the server keeps its own user data, kept out of the worktree. */
  readonly serverDataDir: string
}

export type IdeServerHandle = {
  /** Loopback URL including the connection token, ready for a guest webview. */
  readonly url: string
  readonly port: number
  stop(): Promise<void>
}

export type IdeServerStartFailure = {
  readonly kind: 'exited' | 'timeout'
  /** Exit code when the process died before listening. */
  readonly exitCode?: number | null
  /** Trailing server output, for surfacing in the UI. */
  readonly output: string
}

export class IdeServerStartError extends Error {
  constructor(readonly failure: IdeServerStartFailure) {
    super(
      failure.kind === 'timeout'
        ? 'IDE server did not report a listening address in time'
        : `IDE server exited before listening (code ${failure.exitCode ?? 'unknown'})`
    )
    this.name = 'IdeServerStartError'
  }
}

const READY_TIMEOUT_MS = 60_000
const OUTPUT_TAIL_BYTES = 8_000

/**
 * Starts the server and resolves once it is listening. Rejects with
 * {@link IdeServerStartError} if it exits first or never reports an address;
 * the child is always reaped before rejecting.
 */
export async function startIdeServer(
  spec: IdeServerSpec,
  options: { readonly readyTimeoutMs?: number } = {}
): Promise<IdeServerHandle> {
  const connectionToken = randomBytes(24).toString('hex')
  const child = spawnProcess({
    program: spec.nodeBinary,
    args: [
      spec.serverEntry,
      '--host=127.0.0.1',
      '--port=0',
      `--connection-token=${connectionToken}`,
      `--server-data-dir=${spec.serverDataDir}`,
      '--accept-server-license-terms',
      '--without-browser-env-var',
      spec.folder
    ],
    cwd: spec.folder,
    // ELECTRON_RUN_AS_NODE: the server is plain Node, and the runner is usually
    // Electron's own binary, which would otherwise boot a second app instance.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe'
  })

  try {
    const address = await waitForListening(child, options.readyTimeoutMs ?? READY_TIMEOUT_MS)
    const url = new URL(address)
    url.searchParams.set('tkn', connectionToken)
    url.searchParams.set('folder', spec.folder)
    return {
      url: url.toString(),
      port: Number(url.port),
      stop: () => stopChild(child)
    }
  } catch (error) {
    await stopChild(child)
    throw error
  }
}

function waitForListening(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let output = ''
    let settled = false

    const settle = (run: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', onStdout)
      child.stderr.off('data', onStderr)
      child.off('exit', onExit)
      child.off('error', onError)
      run()
    }

    const record = (chunk: Buffer | string): void => {
      output = (output + String(chunk)).slice(-OUTPUT_TAIL_BYTES)
    }

    const onStdout = (chunk: Buffer | string): void => {
      record(chunk)
      const match = LISTENING_PATTERN.exec(String(chunk))
      if (match?.[1]) {
        const address = match[1]
        settle(() => resolve(address))
      }
    }

    const onStderr = (chunk: Buffer | string): void => record(chunk)

    const onExit = (code: number | null): void =>
      settle(() => reject(new IdeServerStartError({ kind: 'exited', exitCode: code, output })))

    const onError = (error: Error): void => settle(() => reject(error))

    const timer = setTimeout(
      () => settle(() => reject(new IdeServerStartError({ kind: 'timeout', output }))),
      timeoutMs
    )

    child.stdout.on('data', onStdout)
    child.stderr.on('data', onStderr)
    child.on('exit', onExit)
    child.on('error', onError)
  })
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
    child.kill()
    // The server can ignore SIGTERM while extensions shut down; escalate once.
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }, 5_000).unref()
  })
}
