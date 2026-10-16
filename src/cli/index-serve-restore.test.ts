import { describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveKinguAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveKinguAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/kingu-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveKinguAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

describe('kingu serve restore resume', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveKinguAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  it('asks the local Kingu to resume and never starts a server', async () => {
    process.env.KINGU_ENVIRONMENT = 'paired-env'
    callMock.mockResolvedValue({
      id: 'rpc',
      ok: true,
      result: {
        automaticWork: {
          admission: 'enforce',
          mode: { kind: 'normal' },
          cleared: { kind: 'paused', reason: 'unclean_host_death', since: 0 }
        }
      },
      _meta: { runtimeId: 'runtime-1' }
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['serve', 'restore', 'resume'], '/tmp/repo')

    expect(serveKinguAppMock).not.toHaveBeenCalled()
    expect(callMock).toHaveBeenCalledWith('runtime.automaticWork.resume')
    // Why null: `serve` commands always target this machine, never an ambient paired host.
    expect(runtimeClientConstructorMock).toHaveBeenLastCalledWith(null, null)
    expect(logSpy.mock.calls[0]?.[0]).toContain('Automatic restores resumed')
    expect(logSpy.mock.calls[0]?.[0]).toContain('stopped unexpectedly')
  })

  it('says so when nothing was paused, and when the host has no gate', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    callMock.mockResolvedValueOnce({
      id: 'rpc',
      ok: true,
      result: { automaticWork: { admission: 'enforce', mode: { kind: 'normal' }, cleared: null } },
      _meta: { runtimeId: 'runtime-1' }
    })
    await main(['serve', 'restore', 'resume'], '/tmp/repo')
    callMock.mockResolvedValueOnce({
      id: 'rpc',
      ok: true,
      result: { automaticWork: null },
      _meta: { runtimeId: 'runtime-1' }
    })
    await main(['serve', 'restore', 'resume'], '/tmp/repo')

    expect(logSpy.mock.calls[0]?.[0]).toContain('were not paused')
    expect(logSpy.mock.calls[1]?.[0]).toContain('no automatic-restore gate')
  })

  it('explains a terminal host that predates the command', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    callMock.mockResolvedValueOnce({
      id: 'rpc',
      ok: true,
      result: { automaticWork: null, terminalHostPredatesResume: true },
      _meta: { runtimeId: 'runtime-1' }
    })
    await main(['serve', 'restore', 'resume'], '/tmp/repo')
    expect(logSpy.mock.calls[0]?.[0]).toContain('predates this command')
  })
})
