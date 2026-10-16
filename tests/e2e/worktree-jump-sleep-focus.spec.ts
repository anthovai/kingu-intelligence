import { test, expect } from './helpers/kingu-app'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

test('Cmd+J focuses the terminal after waking a sleeping workspace', async ({
  kinguPage
}, testInfo) => {
  await waitForSessionReady(kinguPage)
  const source = await waitForActiveWorktree(kinguPage)
  const target = (await getAllWorktreeIds(kinguPage)).find((id) => id !== source)
  if (!target) {
    throw new Error('Expected a second seeded workspace')
  }
  await switchToWorktree(kinguPage, target)
  await ensureTerminalVisible(kinguPage)
  await waitForActiveTerminalManager(kinguPage)
  await waitForActivePanePtyId(kinguPage)
  const targetName = await kinguPage.evaluate((id) => {
    const state = window.__store!.getState()
    const worktree = state.getKnownWorktreeById(id)
    if (!worktree) {
      throw new Error('Missing target workspace')
    }
    return worktree.branch.replace(/^refs\/heads\//, '')
  }, target)
  await switchToWorktree(kinguPage, source)
  await kinguPage.evaluate(async (id) => {
    await window.__store!.getState().shutdownWorktreeTerminals(id, { keepIdentifiers: true })
  }, target)
  await kinguPage.evaluate(() => {
    const listSessions = window.api.pty.listSessions
    window.api.pty.listSessions = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return listSessions(...args)
    }
  })
  // Native menu accelerators require OS focus; open the same palette in the hidden renderer.
  await kinguPage.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  const dialog = kinguPage.getByRole('dialog', { name: 'Jump to...' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(targetName)
  await expect(dialog.locator('[cmdk-item][data-selected="true"]')).toContainText(targetName)
  const cdp = await kinguPage.context().newCDPSession(kinguPage)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await kinguPage.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await waitForActiveTerminalManager(kinguPage)
  await waitForActivePanePtyId(kinguPage)
  const terminal = kinguPage
    .locator('[data-terminal-tab-id]:visible .xterm-helper-textarea')
    .first()
  await kinguPage.screenshot({ path: testInfo.outputPath('wake-focus.png') })
  await expect(terminal).toBeFocused()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
  await kinguPage.keyboard.type('echo WAKE_KEYBOARD_OK')
  await kinguPage.keyboard.press('Enter')
  await waitForTerminalOutput(kinguPage, 'WAKE_KEYBOARD_OK')
  await kinguPage.screenshot({ path: testInfo.outputPath('wake-typing.png') })
})
