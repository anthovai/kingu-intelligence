import { describe, expect, it } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../src/shared/execution-host'
import {
  buildNewWorkspaceProjectOptions,
  buildNewWorkspaceRunTargetOptions,
  getNewWorkspaceRunTarget
} from './new-workspace-project-targets'

const LOCAL_HOST_LABEL = getLocalExecutionHostLabel('darwin')

describe('new workspace project targets', () => {
  it('groups local and SSH checkouts of the same project', () => {
    const upstream = { owner: 'anthovai', repo: 'kingu' }
    const options = buildNewWorkspaceProjectOptions([
      { id: 'local', displayName: 'kingu', path: '/src/kingu', upstream },
      {
        id: 'ssh',
        displayName: 'kingu',
        path: '/home/dev/kingu',
        connectionId: 'build-server',
        upstream
      }
    ])

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ label: 'kingu', detail: 'anthovai/kingu-intelligence' })
  })

  it('shows the provider slug recovered from canonical git identity', () => {
    const options = buildNewWorkspaceProjectOptions([
      {
        id: 'local',
        displayName: 'kingu',
        path: '/src/kingu',
        gitRemoteIdentity: {
          canonicalKey: 'github.com/anthovai/kingu-intelligence',
          remoteName: 'origin',
          remoteUrl: 'git@github.com:anthovai/kingu-intelligence.git'
        }
      }
    ])

    expect(options[0]).toMatchObject({ label: 'kingu', detail: 'anthovai/kingu-intelligence' })
  })

  it('labels local, SSH, and paired runtime targets', () => {
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'kingu', path: '/src/kingu' }, 'darwin')
    ).toEqual({ label: LOCAL_HOST_LABEL, detail: '/src/kingu' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'kingu', path: 'C:\\src\\kingu' })
    ).toEqual({ label: 'This computer', detail: 'C:\\src\\kingu' })
    expect(
      getNewWorkspaceRunTarget(
        { id: 'local', displayName: 'kingu', path: 'C:\\src\\kingu' },
        'win32'
      )
    ).toEqual({ label: 'Local Windows', detail: 'C:\\src\\kingu' })
    expect(
      getNewWorkspaceRunTarget({
        id: 'ssh',
        displayName: 'kingu',
        path: 'C:\\src\\kingu',
        executionHostId: 'ssh:Windows%20VM'
      })
    ).toEqual({ label: 'SSH · Windows VM', detail: 'C:\\src\\kingu' })
    expect(
      getNewWorkspaceRunTarget({
        id: 'runtime',
        displayName: 'kingu',
        path: '/src/kingu',
        executionHostId: 'runtime:devbox'
      })
    ).toEqual({ label: 'Remote · devbox', detail: '/src/kingu' })
  })

  it('shows one target per host when the project has multiple local worktrees', () => {
    const upstream = { owner: 'anthovai', repo: 'kingu' }
    const repos = [
      { id: 'local-a', displayName: 'kingu-a', path: '/src/kingu-a', upstream },
      { id: 'local-b', displayName: 'kingu-b', path: '/src/kingu-b', upstream },
      {
        id: 'ssh',
        displayName: 'kingu',
        path: '/home/dev/kingu',
        connectionId: 'build-server',
        upstream
      }
    ]
    const projectId = buildNewWorkspaceProjectOptions(repos)[0]?.id ?? null

    expect(buildNewWorkspaceRunTargetOptions(repos, projectId, 'darwin')).toEqual([
      expect.objectContaining({ id: 'local-a', label: LOCAL_HOST_LABEL, detail: '/src/kingu-a' }),
      expect.objectContaining({ id: 'ssh', label: 'SSH · build-server', detail: '/home/dev/kingu' })
    ])
  })
})
