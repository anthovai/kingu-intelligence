import { accessSync, constants } from 'node:fs'
import { delimiter, dirname, isAbsolute, join, relative } from 'node:path'
import { RuntimeClientError } from './types'
import { resolveLaunchUserDataPath } from './launch-user-data-path'

/**
 * Only a CLI run by an installed Kingu app's executable can start a server. The `kingu` that an
 * SSH-launched Kingu server puts on a remote host runs on plain Node, belongs to that server's
 * profile, and is rewritten with each server version.
 */
export function canStartKinguServer(env: NodeJS.ProcessEnv): boolean {
  const override = env.KINGU_APP_EXECUTABLE
  return (
    (typeof override === 'string' && override.trim().length > 0) || env.ELECTRON_RUN_AS_NODE === '1'
  )
}

/** Linux installs the app's CLI as `kingu-ide`: a bare `kingu` there is often the screen reader. */
export function appCliName(platform: NodeJS.Platform): string {
  return platform === 'linux' ? 'kingu-ide' : 'kingu'
}

const NOT_AN_APP_CLI =
  "This `kingu` command isn't running from an installed Kingu app. On a host Kingu reaches over SSH, it belongs to that connection's server and can't start one of its own."

export function serverOnlyServeMessage(platform: NodeJS.Platform): string {
  return `${NOT_AN_APP_CLI} Install the Kingu app on this machine and run \`${appCliName(platform)} serve\` from a plain login shell, or set KINGU_APP_EXECUTABLE to the Kingu app executable.`
}

function serverOnlyServiceInstallMessage(platform: NodeJS.Platform): string {
  const name = appCliName(platform)
  return `Could not find the installed Kingu app's \`${name}\` command on PATH. ${NOT_AN_APP_CLI} Install the Kingu app on this machine, then run \`${name} serve service install\` from a plain login shell so the service uses the app's own profile, or pass --command <absolute path to the app's ${name}>.`
}

function isVersionScopedDir(dir: string, userData: string): boolean {
  const inside = relative(userData, dir)
  return (
    inside === '' ||
    (!inside.startsWith('..') && !isAbsolute(inside)) ||
    dir.includes('kingud-artifacts') ||
    dir.includes('/.mount_')
  )
}

/** The stable launcher on PATH: a version-specific executable would vanish with the next update. */
export function resolveServiceCommand(
  explicit: string | null,
  deps: { platform: NodeJS.Platform; env: NodeJS.ProcessEnv }
): string {
  const isExecutable = (path: string): boolean => {
    try {
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  const userData = resolveLaunchUserDataPath(deps.env)
  if (explicit) {
    if (!isAbsolute(explicit) || !isExecutable(explicit)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--command must be an absolute path to an executable: ${explicit}`
      )
    }
    if (isVersionScopedDir(dirname(explicit), userData)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--command points at a launcher tied to one Kingu version, which the next update replaces: ${explicit}. Pass the installed Kingu app's \`${appCliName(deps.platform)}\` instead.`
      )
    }
    return explicit
  }
  const name = appCliName(deps.platform)
  for (const dir of (deps.env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    // Why skip: launchers under the profile or a mounted AppImage point at one version's files.
    if (!isVersionScopedDir(dir, userData) && isExecutable(join(dir, name))) {
      return join(dir, name)
    }
  }
  throw new RuntimeClientError(
    'cli_not_found',
    canStartKinguServer(deps.env)
      ? `Could not find the \`${name}\` command on PATH. Install it from Kingu Settings, or pass --command <absolute path>.`
      : serverOnlyServiceInstallMessage(deps.platform)
  )
}
