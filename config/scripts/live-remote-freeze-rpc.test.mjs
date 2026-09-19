import { describe, expect, it } from 'vitest'
import {
  appendKinguRpcOutput,
  resolveKinguCliCommand,
  resolveKinguCliInvocation
} from './live-remote-freeze-rpc.mjs'

describe('live remote freeze RPC', () => {
  it('resolves the Kingu CLI for managed, dev, Linux, and default runtimes', () => {
    expect(resolveKinguCliCommand({ env: { KINGU_CLI_COMMAND: 'custom-kingu' } })).toBe(
      'custom-kingu'
    )
    expect(resolveKinguCliCommand({ env: { KINGU_DEV_REPO_ROOT: '/repo' } })).toBe('kingu-dev')
    expect(resolveKinguCliCommand({ env: {}, platform: 'linux' })).toBe('kingu-ide')
    expect(resolveKinguCliCommand({ env: {}, platform: 'win32' })).toBe('kingu')
  })

  it('bypasses the Windows dev cmd shim with the built Node CLI', () => {
    const invocation = resolveKinguCliInvocation({
      env: {
        APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
        KINGU_CLI_COMMAND: 'C:\\repo\\out\\bin\\kingu-dev.cmd',
        KINGU_DEV_REPO_ROOT: 'C:\\repo'
      },
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
    })

    expect(invocation).toMatchObject({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: ['C:\\repo\\out\\cli\\index.js'],
      env: {
        KINGU_USER_DATA_PATH: 'C:\\Users\\dev\\AppData\\Roaming\\kingu-dev',
        KINGU_DEV_CLI_INVOCATION: '1',
        KINGU_APP_EXECUTABLE: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
        KINGU_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      }
    })
  })

  it('caps combined asynchronous output before retaining the overflow chunk', () => {
    const first = appendKinguRpcOutput('', '1234', 0, 5)
    expect(first).toEqual({ output: '1234', bytes: 4, exceeded: false })

    const overflow = appendKinguRpcOutput(first.output, '67', first.bytes, 5)
    expect(overflow).toEqual({ output: '1234', bytes: 6, exceeded: true })
  })
})
