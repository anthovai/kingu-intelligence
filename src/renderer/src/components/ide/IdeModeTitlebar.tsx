import { ChevronLeft } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/**
 * The only Kingu chrome left in IDE mode: a drag region with one way back.
 * The worktree sidebar is hidden here, so without this the mode has no exit.
 */
export function IdeModeTitlebar(): React.JSX.Element {
  const closeIdePage = useAppStore((s) => s.closeIdePage)

  return (
    <div className="titlebar flex items-center">
      <button
        type="button"
        onClick={closeIdePage}
        // Why no-drag: the titlebar itself is a drag region, which would otherwise
        // swallow the click and move the window instead.
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className="ml-2 flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium tracking-tight text-foreground/70 transition-colors hover:bg-foreground/8 hover:text-foreground"
      >
        <ChevronLeft className="size-4 shrink-0" strokeWidth={1.75} />
        <span>{translate('auto.components.ide.IdeModeTitlebar.back', 'Kingu')}</span>
      </button>
    </div>
  )
}
