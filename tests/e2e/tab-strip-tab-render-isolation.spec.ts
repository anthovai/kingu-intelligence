/**
 * E2E test for a long tab strip: a change to one tab must re-render that tab, not the strip.
 *
 * Why E2E: only the whole app shows every React commit a tab change causes — the store write, the
 * strip's projections, and the drag-and-drop context every tab reads.
 */

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/kingu-app'
import { waitForSessionReady, waitForActiveWorktree, ensureTerminalVisible } from './helpers/store'
import { waitForActivePanePtyId } from './helpers/terminal'
import { runNodeScriptInTerminal } from './helpers/run-node-script-in-terminal'
import { startRecordingTabRenders, takeTabRenders } from './helpers/tab-render-recorder'

const BACKGROUND_TABS = 30

// New terminals retitle their tabs for a few seconds after opening; wait for the strip to go quiet.
async function waitForQuietStrip(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await takeTabRenders(page)
        await page.waitForTimeout(500)
        return (await takeTabRenders(page)).length
      },
      { timeout: 30_000 }
    )
    .toBe(0)
}

test.describe('Tab strip tab render isolation', () => {
  test.beforeEach(async ({ kinguPage }) => {
    await waitForSessionReady(kinguPage)
    await waitForActiveWorktree(kinguPage)
    await ensureTerminalVisible(kinguPage)
  })

  test('a title change or a tab switch re-renders only the tabs involved', async ({ kinguPage }) => {
    const worktreeId = await waitForActiveWorktree(kinguPage)
    const ptyId = await waitForActivePanePtyId(kinguPage)
    const tabIds = await kinguPage.evaluate(
      ({ wId, count }) => {
        const ids: string[] = []
        for (let i = 0; i < count; i++) {
          ids.push(
            window.__store!.getState().createTab(wId, undefined, undefined, { activate: false }).id
          )
        }
        return ids
      },
      { wId: worktreeId, count: BACKGROUND_TABS }
    )
    const tab = (tabId: string) =>
      kinguPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
    await expect(tab(tabIds[BACKGROUND_TABS - 1])).toBeAttached()
    await startRecordingTabRenders(kinguPage)

    await waitForQuietStrip(kinguPage)
    await kinguPage.evaluate(
      (tabId) => window.__store!.getState().updateTabTitle(tabId, 'retitled in background'),
      tabIds[5]
    )
    await expect(tab(tabIds[5])).toHaveAttribute('data-tab-title', 'retitled in background')
    const backgroundRetitle = await takeTabRenders(kinguPage)
    // Control: the recorder sees the one tab that did change.
    expect(backgroundRetitle.length).toBeGreaterThan(0)
    expect(Math.max(...backgroundRetitle)).toBe(1)

    await waitForQuietStrip(kinguPage)
    // A node script, so the title is emitted the same way under PowerShell, cmd and POSIX shells.
    // It stays alive until the title is read; a shell prompt would retitle the tab straight back.
    const retitle = await runNodeScriptInTerminal(
      kinguPage,
      ptyId,
      `process.stdout.write('\\x1b]0;retitled by its terminal\\x07'); setTimeout(() => {}, 3000)`
    )
    try {
      await expect(
        kinguPage.locator('[data-testid="sortable-tab"][data-active="true"]')
      ).toHaveAttribute('data-tab-title', 'retitled by its terminal')
      const terminalRetitle = await takeTabRenders(kinguPage)
      expect(terminalRetitle.length).toBeGreaterThan(0)
      expect(Math.max(...terminalRetitle)).toBe(1)
    } finally {
      retitle.cleanup()
    }

    await waitForQuietStrip(kinguPage)
    await tab(tabIds[1]).click()
    await expect(tab(tabIds[1])).toHaveAttribute('data-active', 'true')
    await kinguPage.waitForTimeout(500)
    const tabSwitch = await takeTabRenders(kinguPage)
    expect(tabSwitch.length).toBeGreaterThan(0)
    // The tab that lost the active state and the one that gained it.
    expect(Math.max(...tabSwitch)).toBeLessThanOrEqual(2)
  })
})
