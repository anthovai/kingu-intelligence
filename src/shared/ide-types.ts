/** Contract for the `ide` top-level view's server, shared by main and renderer. */

export type IdeSessionRequest = {
  /** Absolute path the IDE opens. Today this is the active worktree's path. */
  readonly folder: string
}

export type IdeSessionReady = {
  readonly status: 'ready'
  /** Loopback URL carrying the connection token, for the IDE guest webview. */
  readonly url: string
}

export type IdeSessionUnavailable = {
  readonly status: 'unavailable'
  /**
   * Why the IDE cannot run, as a code the renderer maps to copy:
   * - `not-installed`: no IDE server build is bundled with this app
   * - `no-runtime`: no Node binary to run the server with
   * - `start-failed`: the server exited or never reported an address
   */
  readonly reason: 'not-installed' | 'no-runtime' | 'start-failed'
  /** Trailing server output when the failure produced any. */
  readonly detail?: string
}

export type IdeSessionState = IdeSessionReady | IdeSessionUnavailable
