import { useEffect, useRef, useState } from 'react'
import type { IdeSessionState } from '../../../../shared/ide-types'
import { IDE_PARTITION } from '../../../../shared/ide-partition'

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly url: string }
  | {
      readonly kind: 'unavailable'
      readonly state: Extract<IdeSessionState, { status: 'unavailable' }>
    }

const UNAVAILABLE_COPY: Record<
  Extract<IdeSessionState, { status: 'unavailable' }>['reason'],
  string
> = {
  'not-installed': 'The IDE is not bundled with this build.',
  'no-runtime': 'No runtime available to start the IDE server.',
  'start-failed': 'The IDE server did not start.'
}

/**
 * Hosts the bundled IDE as a guest webview. The main process owns the server
 * and mints its URL, so this only starts a session for the active folder and
 * renders whatever it is handed.
 */
export function IdePage({ folder }: { folder: string | null }): React.JSX.Element {
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' })
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!folder) {
      setLoad({ kind: 'idle' })
      return
    }
    let cancelled = false
    setLoad({ kind: 'starting' })
    void window.api.ide
      .open(folder)
      .then((state) => {
        if (cancelled) {
          return
        }
        setLoad(
          state.status === 'ready'
            ? { kind: 'ready', url: state.url }
            : { kind: 'unavailable', state }
        )
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({ kind: 'unavailable', state: { status: 'unavailable', reason: 'start-failed' } })
        }
      })
    return () => {
      cancelled = true
      // Why release and not close: leaving the view is usually a detour, and the
      // main process keeps the server warm briefly in case we come straight back.
      void window.api.ide.release()
    }
  }, [folder])

  // Why imperative: React does not own <webview>, and re-rendering the element
  // would reload the IDE on every unrelated state change.
  useEffect(() => {
    const container = containerRef.current
    if (!container || load.kind !== 'ready') {
      return
    }
    const guest = document.createElement('webview')
    guest.setAttribute('src', load.url)
    guest.setAttribute('partition', IDE_PARTITION)
    guest.setAttribute('allowpopups', 'true')
    guest.style.width = '100%'
    guest.style.height = '100%'
    guest.style.border = '0'
    container.appendChild(guest)
    return () => {
      guest.remove()
    }
  }, [load])

  if (load.kind === 'idle') {
    return <IdeNotice message="Select a workspace to open it in the IDE." />
  }
  if (load.kind === 'starting') {
    return <IdeNotice message="Starting the IDE…" />
  }
  if (load.kind === 'unavailable') {
    return <IdeNotice message={UNAVAILABLE_COPY[load.state.reason]} detail={load.state.detail} />
  }
  return <div ref={containerRef} className="h-full w-full" />
}

export default IdePage

function IdeNotice({ message, detail }: { message: string; detail?: string }): React.JSX.Element {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      {detail ? (
        <pre className="scrollbar-sleek max-h-48 max-w-2xl overflow-auto text-left text-xs text-muted-foreground">
          {detail}
        </pre>
      ) : null}
    </div>
  )
}
