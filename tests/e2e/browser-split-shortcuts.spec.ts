import { expect, test } from './helpers/kingu-app'
import type { Page } from '@stablyai/playwright-test'
import { focusActiveTerminalInput } from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  createBrowserSplit,
  createTerminalBrowserSplit,
  focusBrowserAddressBar,
  focusBrowserGroup,
  guestModifier,
  pressKeyInBrowserGuest,
  shortcutModifier as modifier,
  waitForFocusedGroup
} from './helpers/browser-split-fixture'

function browserFindInput(page: Page) {
  return page.getByPlaceholder('Find in page...')
}

function browserFindCloseButton(page: Page) {
  return browserFindInput(page).locator('xpath=..').getByTitle('Close')
}

function browserSplitFindInput(page: Page, browserTabId: string) {
  return page
    .locator(`[data-browser-overlay-tab-id="${browserTabId}"]`)
    .getByPlaceholder('Find in page...')
}

async function pressFindInBrowserGuest(
  page: Page,
  browserTabId: string,
  browserPageId: string
): Promise<void> {
  await pressKeyInBrowserGuest(page, browserTabId, browserPageId, 'F', [guestModifier])
}

function terminalFindInput(page: Page) {
  return page.locator('[data-terminal-search-root] input:visible')
}

test.describe('browser split shortcuts', () => {
  test.beforeEach(async ({ kinguPage }) => {
    await waitForSessionReady(kinguPage)
    await waitForActiveWorktree(kinguPage)
    await ensureTerminalVisible(kinguPage)
  })

  test('routes repeated Find shortcuts to the focused terminal or browser split', async ({
    kinguPage
  }) => {
    const fixture = await createTerminalBrowserSplit(kinguPage)

    await kinguPage.evaluate(({ terminalGroupId }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (state && worktreeId) {
        state.focusGroup(worktreeId, terminalGroupId)
      }
    }, fixture)
    await focusActiveTerminalInput(kinguPage)
    await waitForFocusedGroup(kinguPage, fixture.terminalGroupId)
    await kinguPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(kinguPage)).toBeFocused()
    await expect(browserFindInput(kinguPage)).toBeHidden()
    await kinguPage.keyboard.press('Escape')

    await focusBrowserGroup(kinguPage, fixture.browserGroupId)
    await focusBrowserAddressBar(kinguPage, fixture.browserTabId)
    await kinguPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(kinguPage)).toBeFocused()
    await expect(terminalFindInput(kinguPage)).toBeHidden()
    await browserFindCloseButton(kinguPage).click()
    await expect(browserFindInput(kinguPage)).toBeHidden()

    await kinguPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(kinguPage)).toBeFocused()
    await browserFindCloseButton(kinguPage).click()

    await kinguPage.evaluate(({ browserTabId }) => {
      window.__store?.getState().closeBrowserTab(browserTabId)
    }, fixture)
    await expect(
      kinguPage.locator(`[data-browser-overlay-tab-id="${fixture.browserTabId}"]`)
    ).toHaveCount(0)

    await focusActiveTerminalInput(kinguPage)
    await kinguPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(kinguPage)).toBeFocused()
    await expect(browserFindInput(kinguPage)).toBeHidden()
  })

  test('opens Find only in the browser split whose guest owns the shortcut', async ({
    kinguPage
  }) => {
    const fixture = await createBrowserSplit(kinguPage)

    await pressFindInBrowserGuest(kinguPage, fixture.firstBrowserTabId, fixture.firstBrowserPageId)

    await expect(browserSplitFindInput(kinguPage, fixture.firstBrowserTabId)).toBeVisible()
    await expect(browserSplitFindInput(kinguPage, fixture.secondBrowserTabId)).toBeHidden()
    await expect
      .poll(() =>
        kinguPage.evaluate(
          ({ browserPageId, browserTabId }) =>
            window.__store
              ?.getState()
              .browserPagesByWorkspace[browserTabId]?.find((page) => page.id === browserPageId)
              ?.loadError?.code ?? null,
          {
            browserPageId: fixture.firstBrowserPageId,
            browserTabId: fixture.firstBrowserTabId
          }
        )
      )
      .toBeNull()
  })

  test('keeps browser Find available when split focus state is temporarily missing', async ({
    kinguPage
  }) => {
    const fixture = await createTerminalBrowserSplit(kinguPage)
    await focusBrowserGroup(kinguPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(kinguPage, fixture.browserTabId)
    await focusBrowserAddressBar(kinguPage, fixture.browserTabId)

    await kinguPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => {
        const activeGroupIdByWorktree = { ...state.activeGroupIdByWorktree }
        delete activeGroupIdByWorktree[worktreeId]
        return { activeGroupIdByWorktree }
      })
    })
    await expect(addressBar).toBeFocused()

    await kinguPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(kinguPage)).toBeFocused()
    await expect(terminalFindInput(kinguPage)).toBeHidden()
  })

  test('keeps browser Find available when the focused split ID is stale', async ({ kinguPage }) => {
    const fixture = await createTerminalBrowserSplit(kinguPage)
    await focusBrowserGroup(kinguPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(kinguPage, fixture.browserTabId)
    await focusBrowserAddressBar(kinguPage, fixture.browserTabId)

    await kinguPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => ({
        activeGroupIdByWorktree: {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: 'removed-group'
        }
      }))
    })
    await expect(addressBar).toBeFocused()

    await kinguPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(kinguPage)).toBeFocused()
    await expect(terminalFindInput(kinguPage)).toBeHidden()
  })
})
