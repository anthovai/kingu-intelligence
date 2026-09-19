import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as IdeServerProcessModule from './ide-server-process'

const existsSyncMock = vi.fn()
const startIdeServerMock = vi.fn()

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => 'E:/ModelBusiness/kingu-intelligence',
    getPath: () => 'C:/data'
  }
}))
vi.mock('node:fs', () => ({ existsSync: (p: string) => existsSyncMock(p) }))
vi.mock('./ide-server-process', async () => {
  const actual = await vi.importActual<typeof IdeServerProcessModule>('./ide-server-process')
  return { ...actual, startIdeServer: (...args: unknown[]) => startIdeServerMock(...args) }
})

const { IdeServerStartError } = await import('./ide-server-process')
const { admitIdeOrigin, getAdmittedIdeOrigin } = await import('./ide-webview-admission')
const { closeIdeSession, openIdeSession, releaseIdeSession } = await import('./ide-session-service')

const handleFor = (url: string) => ({
  url,
  port: Number(new URL(url).port),
  stop: vi.fn(async () => {})
})

beforeEach(async () => {
  await closeIdeSession()
  existsSyncMock.mockReset().mockReturnValue(true)
  startIdeServerMock.mockReset()
})

describe('openIdeSession', () => {
  it('starts a server and admits its origin for the guest webview', async () => {
    startIdeServerMock.mockResolvedValue(handleFor('http://127.0.0.1:5000/?tkn=a'))
    const state = await openIdeSession('C:/work/a')

    expect(state).toEqual({ status: 'ready', url: 'http://127.0.0.1:5000/?tkn=a' })
    expect(getAdmittedIdeOrigin()).toBe('http://127.0.0.1:5000')
  })

  // Why: switching worktrees is routine, so a server per folder would pile up.
  it('reuses the running server when the folder has not changed', async () => {
    startIdeServerMock.mockResolvedValue(handleFor('http://127.0.0.1:5000/?tkn=a'))
    await openIdeSession('C:/work/a')
    await openIdeSession('C:/work/a')

    expect(startIdeServerMock).toHaveBeenCalledTimes(1)
  })

  it('stops the old server before retargeting to another folder', async () => {
    const first = handleFor('http://127.0.0.1:5000/?tkn=a')
    const second = handleFor('http://127.0.0.1:6000/?tkn=b')
    startIdeServerMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    await openIdeSession('C:/work/a')
    const state = await openIdeSession('C:/work/b')

    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ status: 'ready', url: 'http://127.0.0.1:6000/?tkn=b' })
    expect(getAdmittedIdeOrigin()).toBe('http://127.0.0.1:6000')
  })

  // Why serialised: two fast view switches must not leave an unreferenced server.
  it('serialises concurrent opens so only one server survives', async () => {
    const first = handleFor('http://127.0.0.1:5000/?tkn=a')
    const second = handleFor('http://127.0.0.1:6000/?tkn=b')
    startIdeServerMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)

    const [, last] = await Promise.all([openIdeSession('C:/work/a'), openIdeSession('C:/work/b')])

    expect(startIdeServerMock).toHaveBeenCalledTimes(2)
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(last).toEqual({ status: 'ready', url: 'http://127.0.0.1:6000/?tkn=b' })
  })

  // Why this preference: only the packaged distribution ships bundled web
  // assets; the checkout's dev `out/` serves CSS as ES modules and never paints.
  it('prefers the bundled server distribution over the IDE checkout', async () => {
    existsSyncMock.mockImplementation((p: string) => p.includes('vscode-reh-web-win32-x64'))
    startIdeServerMock.mockResolvedValue(handleFor('http://127.0.0.1:5000/?tkn=a'))

    await openIdeSession('C:/work/a')

    const entry = startIdeServerMock.mock.calls[0]?.[0]?.serverEntry as string
    expect(entry).toContain('vscode-reh-web-win32-x64')
  })

  it('falls back to the IDE checkout when no distribution is present', async () => {
    existsSyncMock.mockImplementation((p: string) => p.includes('kingu-ide'))
    startIdeServerMock.mockResolvedValue(handleFor('http://127.0.0.1:5000/?tkn=a'))

    await openIdeSession('C:/work/a')

    const entry = startIdeServerMock.mock.calls[0]?.[0]?.serverEntry as string
    expect(entry).toContain('kingu-ide')
  })

  it('reports not-installed when no IDE build is bundled', async () => {
    existsSyncMock.mockReturnValue(false)
    expect(await openIdeSession('C:/work/a')).toEqual({
      status: 'unavailable',
      reason: 'not-installed'
    })
    expect(startIdeServerMock).not.toHaveBeenCalled()
  })

  it('surfaces the server output when it fails to start', async () => {
    startIdeServerMock.mockRejectedValue(
      new IdeServerStartError({ kind: 'exited', exitCode: 1, output: 'EADDRINUSE' })
    )
    expect(await openIdeSession('C:/work/a')).toEqual({
      status: 'unavailable',
      reason: 'start-failed',
      detail: 'EADDRINUSE'
    })
  })

  // Why: an admitted origin with no server behind it would let a reused port attach.
  it('leaves no origin admitted after a failed start', async () => {
    admitIdeOrigin('http://127.0.0.1:5000/')
    startIdeServerMock.mockRejectedValue(new Error('boom'))
    await openIdeSession('C:/work/a')
    expect(getAdmittedIdeOrigin()).toBeNull()
  })
})

describe('releaseIdeSession', () => {
  it('keeps the server up during the grace period', async () => {
    vi.useFakeTimers()
    const handle = handleFor('http://127.0.0.1:5000/?tkn=a')
    startIdeServerMock.mockResolvedValue(handle)
    await openIdeSession('C:/work/a')

    releaseIdeSession()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(handle.stop).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('stops the server once the grace period elapses', async () => {
    vi.useFakeTimers()
    const handle = handleFor('http://127.0.0.1:5000/?tkn=a')
    startIdeServerMock.mockResolvedValue(handle)
    await openIdeSession('C:/work/a')

    releaseIdeSession()
    await vi.advanceTimersByTimeAsync(120_000)

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(getAdmittedIdeOrigin()).toBeNull()
    vi.useRealTimers()
  })

  // Why: flipping to the terminal and straight back is the common case; it must
  // not pay for a restart.
  it('cancels the pending stop when the view comes back', async () => {
    vi.useFakeTimers()
    const handle = handleFor('http://127.0.0.1:5000/?tkn=a')
    startIdeServerMock.mockResolvedValue(handle)
    await openIdeSession('C:/work/a')

    releaseIdeSession()
    await vi.advanceTimersByTimeAsync(30_000)
    await openIdeSession('C:/work/a')
    await vi.advanceTimersByTimeAsync(120_000)

    expect(handle.stop).not.toHaveBeenCalled()
    expect(startIdeServerMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does nothing when no server is running', () => {
    expect(() => releaseIdeSession()).not.toThrow()
  })
})

describe('closeIdeSession', () => {
  it('stops the server and revokes its admission', async () => {
    const handle = handleFor('http://127.0.0.1:5000/?tkn=a')
    startIdeServerMock.mockResolvedValue(handle)
    await openIdeSession('C:/work/a')

    await closeIdeSession()

    expect(handle.stop).toHaveBeenCalledTimes(1)
    expect(getAdmittedIdeOrigin()).toBeNull()
  })

  it('is safe to call when nothing is running', async () => {
    await expect(closeIdeSession()).resolves.toBeUndefined()
  })
})
