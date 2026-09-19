import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnProcessMock = vi.fn()
vi.mock('../../shared/child-process/run-process', () => ({
  spawnProcess: (...args: unknown[]) => spawnProcessMock(...args)
}))

const { IdeServerStartError, startIdeServer } = await import('./ide-server-process')

/** Minimal stand-in for the spawned server: streams plus exit/kill bookkeeping. */
class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killed: NodeJS.Signals[] = []

  kill(signal?: NodeJS.Signals): boolean {
    this.killed.push(signal ?? 'SIGTERM')
    // Real servers exit asynchronously; mirror that so stop() has to await.
    queueMicrotask(() => {
      this.exitCode = 0
      this.emit('exit', 0)
    })
    return true
  }
}

const SPEC = {
  serverEntry: 'C:/app/ide/out/server-main.js',
  nodeBinary: 'C:/app/kingu.exe',
  folder: 'C:/work/project',
  serverDataDir: 'C:/data/ide-server'
}

let child: FakeChild

beforeEach(() => {
  child = new FakeChild()
  spawnProcessMock.mockReset()
  spawnProcessMock.mockReturnValue(child)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('startIdeServer', () => {
  it('resolves with the listening address plus a connection token and folder', async () => {
    const pending = startIdeServer(SPEC)
    child.stdout.write('Web UI available at http://127.0.0.1:51234/\n')
    const handle = await pending

    const url = new URL(handle.url)
    expect(url.origin).toBe('http://127.0.0.1:51234')
    expect(url.searchParams.get('folder')).toBe(SPEC.folder)
    expect(handle.port).toBe(51234)
    // Why assert shape, not value: the token is random per start by design.
    expect(url.searchParams.get('tkn')).toMatch(/^[0-9a-f]{48}$/)
  })

  it('passes the token to the server so the URL and the process agree', async () => {
    const pending = startIdeServer(SPEC)
    child.stdout.write('Web UI available at http://127.0.0.1:51234/\n')
    const handle = await pending

    const args = spawnProcessMock.mock.calls[0]?.[0]?.args as string[]
    const spawnedToken = args
      .find((arg) => arg.startsWith('--connection-token='))
      ?.slice('--connection-token='.length)
    expect(new URL(handle.url).searchParams.get('tkn')).toBe(spawnedToken)
  })

  it('runs the Electron binary as plain Node so no second app instance boots', async () => {
    const pending = startIdeServer(SPEC)
    child.stdout.write('Web UI available at http://127.0.0.1:51234/\n')
    await pending

    const spec = spawnProcessMock.mock.calls[0]?.[0]
    expect(spec.program).toBe(SPEC.nodeBinary)
    expect(spec.env?.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(spec.args).toContain('--host=127.0.0.1')
  })

  it('reports the exit and its output when the server dies before listening', async () => {
    const pending = startIdeServer(SPEC)
    child.stderr.write('EADDRINUSE: address already in use\n')
    await Promise.resolve()
    child.exitCode = 1
    child.emit('exit', 1)

    await expect(pending).rejects.toBeInstanceOf(IdeServerStartError)
    await pending.catch((error: InstanceType<typeof IdeServerStartError>) => {
      expect(error.failure.kind).toBe('exited')
      expect(error.failure.exitCode).toBe(1)
      expect(error.failure.output).toContain('EADDRINUSE')
    })
  })

  it('gives up when the server never reports an address, and reaps it', async () => {
    vi.useFakeTimers()
    const pending = startIdeServer(SPEC, { readyTimeoutMs: 1000 })
    const assertion = expect(pending).rejects.toMatchObject({
      failure: { kind: 'timeout' }
    })
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
    expect(child.killed.length).toBeGreaterThan(0)
  })

  // Why: a started server that outlives its handle keeps a loopback port open
  // with a live token, which is exactly what the admission registry assumes away.
  it('stop() terminates the child', async () => {
    const pending = startIdeServer(SPEC)
    child.stdout.write('Web UI available at http://127.0.0.1:51234/\n')
    const handle = await pending

    await handle.stop()
    expect(child.killed).toContain('SIGTERM')
  })

  it('stop() is a no-op once the child has already exited', async () => {
    const pending = startIdeServer(SPEC)
    child.stdout.write('Web UI available at http://127.0.0.1:51234/\n')
    const handle = await pending

    child.exitCode = 0
    await handle.stop()
    expect(child.killed).toHaveLength(0)
  })
})
