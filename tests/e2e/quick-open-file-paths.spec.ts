import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/kingu-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const relativeFilePath =
  'packages/kingu/src/renderer/src/components/navigation/worktree/quick-open/long-path-fixtures/very-deeply-nested-folder/QuickOpenTarget.tsx'

test('cmd+p quick open prioritizes the filename and reveals the full path on hover', async ({
  electronApp,
  kinguPage,
  testRepoPath
}) => {
  const filePath = path.join(testRepoPath, ...relativeFilePath.split('/'))
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'export const QuickOpenTarget = true\n')

  await waitForSessionReady(kinguPage)
  await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)

  // Headless Playwright keyboard events bypass Electron’s before-input-event shortcut path.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('ui:openQuickOpen')
  })
  const dialog = kinguPage.getByRole('dialog', { name: 'Go to file' })
  await expect(dialog).toBeVisible()
  const inputBox = await dialog.locator('[data-cmdk-input-wrapper]').boundingBox()
  expect(inputBox).not.toBeNull()
  expect(inputBox!.height).toBeLessThanOrEqual(45)
  const input = dialog.locator('input[placeholder="Go to file..."]')
  await input.fill('QuickOpenTarget')

  const row = dialog.getByRole('option').filter({ hasText: 'QuickOpenTarget.tsx' }).first()
  await expect(row).toBeVisible()
  await expect(row).toContainText('packages/kingu/src/renderer/src/components/navigation/')
  const rowBox = await row.boundingBox()
  expect(rowBox).not.toBeNull()
  expect(rowBox!.height).toBeLessThanOrEqual(29)
  const rowText = await row.textContent()
  expect(rowText?.indexOf('QuickOpenTarget.tsx')).toBeLessThan(
    rowText?.indexOf('packages/kingu/src/renderer/src/components/navigation/') ?? -1
  )

  const tooltip = kinguPage
    .locator('[data-slot="tooltip-content"]')
    .filter({ hasText: relativeFilePath })
  // Streaming results can remount the row under a stationary pointer, and a
  // tooltip left open from a prior attempt can swallow the next hover.
  await expect(async () => {
    await kinguPage.mouse.move(8, 8)
    await row.hover({ position: { x: 20, y: 12 }, timeout: 2_000 })
    await row.hover({ position: { x: 40, y: 12 }, timeout: 2_000 })
    await expect(tooltip).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000, intervals: [100, 250, 500] })

  // Exact cursor placement is arithmetic, unit-tested via cursorTooltipOffsets.
  // Asserting it here measures the app mid-reflow and is flaky; what E2E is
  // uniquely good for is that the tooltip really opens with the whole path.
  await expect(tooltip).toBeVisible()

  const proofPath = process.env.KINGU_QUICK_OPEN_PROOF_PATH
  if (proofPath) {
    await kinguPage.screenshot({ path: proofPath })
  }
})
