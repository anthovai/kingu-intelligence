import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElectronHomeIsolation } from './electron-home-isolation'

const execFileAsync = promisify(execFile)
const RUNTIME_METADATA_FILE = 'kingu-runtime.json'
let kinguDevUserDataPath: string | null = null
let kinguServeProcess: ChildProcess | null = null
let kinguServeStdout = ''
let kinguServeStderr = ''

export type CliResult = {
  stdout: string
  stderr: string
}

type RunKinguCliOptions = {
  retryMissingRuntimeMetadata?: boolean
}

export async function runKinguCli(
  args: string[],
  options: RunKinguCliOptions = {}
): Promise<CliResult> {
  try {
    return await runKinguCliOnce(args)
  } catch (error) {
    if (
      options.retryMissingRuntimeMetadata !== false &&
      isMissingRuntimeMetadataError(args, error)
    ) {
      // Why: Windows CI can let the dev runtime exit while launching the
      // fixture app; reopen once so the desktop action gets a live runtime.
      await ensureKinguRuntimeLaunched()
      return await runKinguCliOnce(args)
    }
    throw error
  }
}

async function runKinguCliOnce(args: string[]): Promise<CliResult> {
  const devCli = join(process.cwd(), 'config/scripts/kingu-dev.mjs')
  const command = process.env.KINGU_COMPUTER_CLI ?? process.execPath
  const cliArgs = process.env.KINGU_COMPUTER_CLI ? args : [devCli, ...args]
  const env = process.env.KINGU_COMPUTER_CLI
    ? { ...process.env }
    : await createComputerE2ERuntimeEnv()
  try {
    const result = await execFileAsync(command, cliArgs, {
      env,
      maxBuffer: 20 * 1024 * 1024
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const output = error as { message: string; stdout: string; stderr: string }
      throw new Error(`${output.message}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
    }
    throw error
  }
}

export async function ensureKinguRuntimeLaunched(): Promise<void> {
  if (!process.env.KINGU_COMPUTER_CLI && process.platform === 'win32') {
    await ensureKinguRuntimeServed()
    return
  }
  await runKinguCli(['open', '--json'], { retryMissingRuntimeMetadata: false })
  await waitForKinguRuntimeReady()
}

export async function stopKinguRuntime(): Promise<void> {
  const processToStop = kinguServeProcess
  if (!processToStop?.pid) {
    return
  }
  kinguServeProcess = null
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'])
    } catch {
      // The foreground test runtime may already have exited.
    }
    return
  }
  processToStop.kill()
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

async function getComputerE2eKinguDevUserDataPath(): Promise<string> {
  if (!kinguDevUserDataPath) {
    // Why: the shared kingu-dev profile can keep an older runtime alive across
    // local test runs, making computer-use E2E exercise stale provider code.
    kinguDevUserDataPath = await mkdtemp(join(tmpdir(), 'kingu-computer-runtime-'))
  }
  return kinguDevUserDataPath
}

async function waitForKinguRuntimeReady(): Promise<void> {
  const userDataPath = await getComputerE2eKinguDevUserDataPath()
  const metadataPath = join(userDataPath, RUNTIME_METADATA_FILE)
  const deadline = Date.now() + 15000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await access(metadataPath)
      const status = parseJsonOutput<{
        result: { runtime: { reachable: boolean } }
      }>((await runKinguCli(['status', '--json'], { retryMissingRuntimeMetadata: false })).stdout)
      if (status.result.runtime.reachable) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  const detail = [
    lastError instanceof Error ? `Last error: ${lastError.message}` : null,
    kinguServeStdout.trim() ? `serve stdout: ${kinguServeStdout.trim()}` : null,
    kinguServeStderr.trim() ? `serve stderr: ${kinguServeStderr.trim()}` : null
  ]
    .filter(Boolean)
    .join(' ')
  throw new Error(`Kingu runtime metadata was not ready at ${metadataPath}.${detail}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureKinguRuntimeServed(): Promise<void> {
  if (!kinguServeProcess || kinguServeProcess.exitCode !== null) {
    const devCli = join(process.cwd(), 'config/scripts/kingu-dev.mjs')
    const env = await createComputerE2ERuntimeEnv()
    kinguServeStdout = ''
    kinguServeStderr = ''
    kinguServeProcess = spawn(process.execPath, [devCli, 'serve', '--no-pairing', '--json'], {
      env,
      windowsHide: true
    })
    kinguServeProcess.stdout?.on('data', (chunk) => {
      kinguServeStdout += String(chunk)
    })
    kinguServeProcess.stderr?.on('data', (chunk) => {
      kinguServeStderr += String(chunk)
    })
    kinguServeProcess.once('exit', () => {
      kinguServeProcess = null
    })
    process.once('exit', () => {
      kinguServeProcess?.kill()
    })
  }
  await waitForKinguRuntimeReady()
}

async function createComputerE2ERuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const userDataDir =
    process.env.KINGU_DEV_USER_DATA_PATH ?? (await getComputerE2eKinguDevUserDataPath())
  // Why: agent runtimes export ELECTRON_RUN_AS_NODE, which would make the
  // spawned Electron behave as plain Node; strip it like every other caller.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  return {
    ...isolation.env,
    // Why: the Node CLI and the Electron child must resolve the same runtime
    // metadata while the E2E boundary owns their home and Codex paths.
    KINGU_DEV_USER_DATA_PATH: userDataDir
  }
}

function isMissingRuntimeMetadataError(args: string[], error: unknown): boolean {
  if (args[0] !== 'computer') {
    return false
  }
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false
  }
  const message = String((error as { message?: unknown }).message)
  return (
    message.includes('"code": "runtime_unavailable"') &&
    message.includes('Could not read Kingu runtime metadata')
  )
}
