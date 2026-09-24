import type { Page } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { test, expect } from './helpers/kingu-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { parkHiddenTabBehindDecoy } from './helpers/terminal-hidden-parking'
import {
  execInTerminal,
  getTerminalContent,
  waitForActiveTerminalManager,
  waitForPaneIdentitySnapshot
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'

const PARKING_DELAY_MS = Number(process.env.KINGU_E2E_TERMINAL_PARKING_DELAY_MS) || 500

test.use({
  kinguAppExtraEnv: { KINGU_E2E_TERMINAL_PARKING_DELAY_MS: String(PARKING_DELAY_MS) }
})

async function hasPtySession(page: Page, ptyId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const sessions = await window.api.pty.listSessions()
    return sessions.some((session) => session.id === id)
  }, ptyId)
}

async function createActiveTerminalTab(page: Page, worktreeId: string): Promise<void> {
  const tabId = await page.evaluate((id) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    const state = store.getState()
    const tab = state.createTab(id, undefined, undefined, { activate: true })
    state.setActiveTab(tab.id)
    state.setActiveTabType('terminal')
    return tab.id
  }, worktreeId)

  await waitForActiveTerminalManager(page, 30_000)
  expect((await waitForPaneIdentitySnapshot(page, 1)).tabId).toBe(tabId)
}

test('closing a parked terminal tab retires its exact PTY session', async ({ kinguPage }) => {
  await waitForSessionReady(kinguPage)
  const worktreeId = await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await waitForActiveTerminalManager(kinguPage, 30_000)

  const snapshot = await waitForPaneIdentitySnapshot(kinguPage, 1)
  const tabId = snapshot.tabId
  const ptyId = snapshot.panes[0]?.ptyId
  if (!ptyId) {
    throw new Error('active terminal pane did not bind a PTY')
  }

  const tab = kinguPage.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`)
  await expect(tab).toBeVisible()

  const marker = `PARKED_CLOSE_READY_${randomUUID()}`
  const keepAliveScript = `process.stdout.write(${JSON.stringify(`${marker}\n`)}); setInterval(() => {}, 1000)`
  await execInTerminal(kinguPage, ptyId, nodeTerminalCommand(['-e', keepAliveScript]))
  await expect
    .poll(() => getTerminalContent(kinguPage), {
      timeout: 10_000,
      message: 'long-lived terminal child did not print its ready marker'
    })
    .toContain(marker)
  await expect.poll(() => hasPtySession(kinguPage, ptyId), { timeout: 10_000 }).toBe(true)

  // Why: the most recently hidden tab stays warm, so tab B must take that
  // exemption before the helper opens decoy tab C and makes tab A parkable.
  await createActiveTerminalTab(kinguPage, worktreeId)
  await parkHiddenTabBehindDecoy(kinguPage, worktreeId, tabId, {
    parkDelayMs: PARKING_DELAY_MS
  })
  // Why: parking must remove only the renderer view; otherwise the retirement
  // assertion could pass because the PTY died before the close action ran.
  await expect.poll(() => hasPtySession(kinguPage, ptyId), { timeout: 10_000 }).toBe(true)

  await kinguPage.evaluate((id) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    store.getState().closeTab(id)
  }, tabId)

  await expect
    .poll(() => hasPtySession(kinguPage, ptyId), {
      timeout: 15_000,
      message: `parked tab close did not retire PTY ${ptyId}`
    })
    .toBe(false)
  await expect(tab).toHaveCount(0)
})
