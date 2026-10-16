import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ServeKingudLaunch from './serve-kingud-launch'

const { spawnMock, resolveLocalServeRuntimeMock, serveWithKingudMock, refuseIfProfileServedMock } =
  vi.hoisted(() => ({
    spawnMock: vi.fn(),
    resolveLocalServeRuntimeMock: vi.fn(),
    serveWithKingudMock: vi.fn(),
    refuseIfProfileServedMock: vi.fn()
  }))

vi.mock('child_process', () => ({ spawn: spawnMock, spawnSync: vi.fn() }))
// Why: these cover host selection; the pre-exec profile check would read this machine's own profile.
vi.mock('./serve-electron-preflight', () => ({
  preflightElectronServe: () => null,
  recordElectronServeStartupAbort: vi.fn(),
  refuseIfProfileServed: refuseIfProfileServedMock
}))
vi.mock('./serve-kingud-launch', async (importOriginal) => ({
  ...(await importOriginal<typeof ServeKingudLaunch>()),
  resolveLocalServeRuntime: resolveLocalServeRuntimeMock,
  serveWithKingud: serveWithKingudMock
}))

import { serveKinguApp } from './launch'

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  kill = vi.fn()
  unref = vi.fn()
  pid = 4101
}

/** Electron serve that exits cleanly once spawned, whenever selection gets to spawning it. */
function electronChild(): void {
  spawnMock.mockImplementation(() => {
    const child = new FakeChildProcess()
    setTimeout(() => child.emit('exit', 0, null), 0)
    return child
  })
}

describe('kingu serve host selection', () => {
  let stderr: string[]

  beforeEach(() => {
    spawnMock.mockReset()
    resolveLocalServeRuntimeMock.mockReset()
    serveWithKingudMock.mockReset()
    process.env.KINGU_APP_EXECUTABLE = '/opt/kingu/kingu-ide'
    stderr = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderr.push(String(chunk))
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.KINGU_APP_EXECUTABLE
    delete process.env.KINGU_SERVE_RUNTIME
    delete process.env.KINGU_USER_DATA_PATH
    delete process.env.KINGU_DEV_USER_DATA_PATH
    delete process.env.KINGU_APP_EXECUTABLE_NEEDS_APP_ROOT
  })

  it('checks for a live peer before kingud only when supervised, so the brake never counts it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kingu-serve-kingud-supervise-'))
    try {
      process.env.KINGU_APP_EXECUTABLE = join(root, 'kingu')
      await writeFile(process.env.KINGU_APP_EXECUTABLE, '')
      process.env.KINGU_USER_DATA_PATH = join(root, 'profile')
      const selection = { kind: 'kingud', runtime: '/node', entry: '/slot/kingud.js', version: '1' }
      resolveLocalServeRuntimeMock.mockResolvedValue(selection)
      serveWithKingudMock.mockResolvedValue(0)

      refuseIfProfileServedMock.mockReturnValue(null)
      await expect(serveKinguApp({})).resolves.toBe(0)
      expect(refuseIfProfileServedMock).not.toHaveBeenCalled()

      refuseIfProfileServedMock.mockImplementation(async () => {
        setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 20)
        return 3
      })
      serveWithKingudMock.mockClear()
      await expect(serveKinguApp({ supervise: true })).resolves.toBe(0)
      expect(serveWithKingudMock).not.toHaveBeenCalled()
      expect(stderr.join('')).toContain('Another Kingu serves this profile')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('serves on kingud by default', async () => {
    const selection = { kind: 'kingud', runtime: '/node', entry: '/slot/kingud.js', version: '1' }
    resolveLocalServeRuntimeMock.mockResolvedValue(selection)
    serveWithKingudMock.mockResolvedValue(0)

    await expect(serveKinguApp({ json: true })).resolves.toBe(0)
    expect(serveWithKingudMock).toHaveBeenCalledWith(
      selection,
      { json: true },
      expect.any(String),
      expect.not.objectContaining({ ELECTRON_RUN_AS_NODE: expect.anything() })
    )
    expect(spawnMock).not.toHaveBeenCalled()
    expect(stderr.join('')).toContain('[serve] running on kingud 1')
  })

  it('falls back to Electron and prints why when kingud cannot serve', async () => {
    resolveLocalServeRuntimeMock.mockResolvedValue({ kind: 'electron', reason: 'no template' })
    electronChild()

    await expect(serveKinguApp({ json: true })).resolves.toBe(0)
    expect(spawnMock).toHaveBeenCalledWith(
      '/opt/kingu/kingu-ide',
      expect.arrayContaining(['--serve', '--serve-json']),
      expect.any(Object)
    )
    expect(stderr.join('')).toContain('[serve] using Electron serve: no template')
  })

  it('keeps Electron without asking kingud when KINGU_SERVE_RUNTIME=electron', async () => {
    process.env.KINGU_SERVE_RUNTIME = 'electron'
    electronChild()

    await expect(serveKinguApp({ json: true })).resolves.toBe(0)
    expect(resolveLocalServeRuntimeMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledOnce()
    expect(stderr.join('')).not.toContain('[serve]')
  })

  describe('serves the profile it selected on', () => {
    function electronSpawn(): { args: string[]; env: NodeJS.ProcessEnv } {
      const [, args, options] = spawnMock.mock.calls[0]
      return { args, env: options.env }
    }

    it('starts the Electron fallback on KINGU_USER_DATA_PATH, not the default profile', async () => {
      const profile = resolve('/isolated/profile-r')
      process.env.KINGU_USER_DATA_PATH = profile
      resolveLocalServeRuntimeMock.mockResolvedValue({ kind: 'electron', reason: 'ssh targets' })
      electronChild()

      await expect(serveKinguApp({ json: true })).resolves.toBe(0)
      expect(resolveLocalServeRuntimeMock).toHaveBeenCalledWith(
        expect.objectContaining({ userDataPath: profile })
      )
      const child = electronSpawn()
      expect(child.args).toContain(`--user-data-dir=${profile}`)
      expect(child.env).toMatchObject({
        KINGU_USER_DATA_PATH: profile,
        KINGU_SERVE_USER_DATA_PATH: profile
      })
    })

    it('pins the opt-out Electron serve to the same profile', async () => {
      const profile = resolve('/isolated/profile-e')
      process.env.KINGU_USER_DATA_PATH = profile
      process.env.KINGU_SERVE_RUNTIME = 'electron'
      electronChild()

      await expect(serveKinguApp({ json: true })).resolves.toBe(0)
      expect(electronSpawn().args).toContain(`--user-data-dir=${profile}`)
    })

    it('hands kingud the absolute profile the selector read', async () => {
      process.env.KINGU_USER_DATA_PATH = join('relative', 'profile')
      const selection = { kind: 'kingud', runtime: '/node', entry: '/slot/kingud.js', version: '1' }
      resolveLocalServeRuntimeMock.mockResolvedValue(selection)
      serveWithKingudMock.mockResolvedValue(0)

      await expect(serveKinguApp({})).resolves.toBe(0)
      const profile = resolve('relative', 'profile')
      expect(resolveLocalServeRuntimeMock).toHaveBeenCalledWith(
        expect.objectContaining({ userDataPath: profile })
      )
      expect(serveWithKingudMock).toHaveBeenCalledWith(selection, {}, profile, expect.any(Object))
    })

    it('uses KINGU_DEV_USER_DATA_PATH for both the selector and a dev Electron child', async () => {
      const profile = resolve('/isolated/dev-profile')
      delete process.env.KINGU_USER_DATA_PATH
      process.env.KINGU_DEV_USER_DATA_PATH = profile
      process.env.KINGU_APP_EXECUTABLE_NEEDS_APP_ROOT = '1'
      resolveLocalServeRuntimeMock.mockResolvedValue({ kind: 'electron', reason: 'dev' })
      electronChild()

      await expect(serveKinguApp({ json: true })).resolves.toBe(0)
      expect(resolveLocalServeRuntimeMock).toHaveBeenCalledWith(
        expect.objectContaining({ userDataPath: profile })
      )
      // A dev build ignores --user-data-dir and reads this instead.
      expect(electronSpawn().env).toMatchObject({
        KINGU_DEV_USER_DATA_PATH: profile,
        KINGU_SERVE_USER_DATA_PATH: profile
      })
    })
  })
})
