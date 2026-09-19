/**
 * Admission record for the IDE guest webview.
 *
 * The IDE server's origin is minted by the main process when the server starts,
 * so the renderer never chooses what the guest may load. `will-attach-webview`
 * consults this registry, which holds at most one origin at a time and is
 * cleared the moment the server stops.
 */

import { IDE_PARTITION } from '../../shared/ide-partition'

let admittedOrigin: string | null = null

/** Called when a server becomes reachable. Replaces any previous admission. */
export function admitIdeOrigin(url: string): void {
  admittedOrigin = originOf(url)
}

/** Called when the server stops, so a stale origin cannot be re-attached. */
export function revokeIdeOrigin(): void {
  admittedOrigin = null
}

export function getAdmittedIdeOrigin(): string | null {
  return admittedOrigin
}

/**
 * True only for the exact origin the running server was started on, on the IDE
 * partition. Any other partition, or any other origin, is not this guest.
 */
export function isAdmissibleIdeAttach(partition: string, src: string): boolean {
  if (partition !== IDE_PARTITION || admittedOrigin === null) {
    return false
  }
  return originOf(src) === admittedOrigin
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value)
    // Loopback only: the server binds 127.0.0.1, so anything else is not it.
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}
