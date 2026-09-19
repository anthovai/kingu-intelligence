import type { IdeSessionState } from '../../shared/ide-types'

export type IdeApi = {
  /** Starts or retargets the IDE server and resolves a URL for the guest. */
  open: (folder: string) => Promise<IdeSessionState>
  /** Stops the server; the guest must be unmounted first. */
  close: () => Promise<void>
  /** Signals the view is hidden; the server stops after a grace period. */
  release: () => Promise<void>
}
