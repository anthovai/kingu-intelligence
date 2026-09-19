import { describe, expect, it } from 'vitest'
import { canShowRightSidebarForView } from './right-sidebar-visibility'

describe('right sidebar in IDE mode', () => {
  // Why: the IDE takes the whole window and ships its own explorer and source
  // control, so Kingu's right sidebar would duplicate both.
  it('is suppressed', () => {
    expect(canShowRightSidebarForView('ide')).toBe(false)
  })

  it('still shows on the workspace view', () => {
    expect(canShowRightSidebarForView('terminal')).toBe(true)
  })
})
