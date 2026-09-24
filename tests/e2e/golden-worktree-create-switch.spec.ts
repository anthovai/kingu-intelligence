import { openSidebarWorkspaceComposer } from './helpers/sidebar-project-dialog'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/kingu-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { createTerminalTabFromMenu } from './helpers/terminal-tab-menu'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { splitMarkerEchoCommand } from './terminal-marker-echo-command'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

async function createWorkspace(page: Page, name: string): Promise<void> {
  await openSidebarWorkspaceComposer(page)
  const dialog = page.getByRole('dialog', { name: /Create (Workspace|Worktree)/i })
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder(/Type a name/i).fill(name)
  await dialog.getByRole('button', { name: /Create (Workspace|Worktree)/i }).click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })
}

async function removeCreatedWorktree(page: Page, worktreeId: string): Promise<void> {
  await page.evaluate(async (id) => {
    await window.__store?.getState().removeWorktree(id, true)
  }, worktreeId)
}

test('creates a worktree, keeps its terminal isolated, and switches back @golden', async ({
  kinguPage
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(kinguPage)
  const originalWorktreeId = await waitForActiveWorktree(kinguPage)
  await waitForActiveTerminalManager(kinguPage, 30_000)
  const parentPtyId = await waitForActivePanePtyId(kinguPage)
  const workspaceName = `golden-switch-${Date.now()}`
  let childWorktreeId: string | null = null

  try {
    await createWorkspace(kinguPage, workspaceName)
    await expect(
      kinguPage.locator('[role="option"][aria-current="page"]').filter({ hasText: workspaceName })
    ).toBeVisible({ timeout: 30_000 })
    childWorktreeId = await waitForActiveWorktree(kinguPage)
    // Why: the cleanup force-removes childWorktreeId, so it must never resolve to the original.
    expect(childWorktreeId).not.toBe(originalWorktreeId)
    await expect(
      kinguPage.locator(`[role="option"][data-worktree-id="${childWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page')

    await createTerminalTabFromMenu(kinguPage)
    await waitForActiveTerminalManager(kinguPage, 30_000)
    const childPtyId = await waitForActivePanePtyId(kinguPage)
    expect(childPtyId).not.toBe(parentPtyId)
    await waitForPtyShellEcho(kinguPage, childPtyId, 15_000)
    await execInTerminal(kinguPage, childPtyId, splitMarkerEchoCommand('worktree', '-b'))
    await waitForTerminalOutput(kinguPage, 'worktree-b')

    await kinguPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`).click()
    await expect(
      kinguPage.locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
    ).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })
    // Why: sidebar aria-current can land before the store/terminal remount.
    // Mac release goldens then wait 30s on a child tab whose PaneManager is gone.
    await expect
      .poll(() => getActiveWorktreeId(kinguPage), {
        timeout: 20_000,
        message: 'store did not activate the original worktree after sidebar click'
      })
      .toBe(originalWorktreeId)
    await ensureTerminalVisible(kinguPage)
    await waitForActiveTerminalManager(kinguPage, 30_000)
    expect(await waitForActivePanePtyId(kinguPage, 30_000)).toBe(parentPtyId)
  } finally {
    if (childWorktreeId) {
      if ((await getActiveWorktreeId(kinguPage).catch(() => null)) !== originalWorktreeId) {
        await kinguPage
          .locator(`[role="option"][data-worktree-id="${originalWorktreeId}"]`)
          .click()
          .catch(() => undefined)
      }
      await removeCreatedWorktree(kinguPage, childWorktreeId).catch(() => undefined)
    }
  }
})
