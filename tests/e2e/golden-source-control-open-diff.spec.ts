import { realpathSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/kingu-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_ADDED_LINE,
  GOLDEN_CHANGED_PATH,
  GOLDEN_REMOVED_LINE,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

test('@golden opens an unstaged file diff from Source Control', async ({
  kinguPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'open-diff')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  seedGoldenSourceEdit(fixture.worktreePath)

  await waitForSessionReady(kinguPage)
  await openGoldenSourceControl(kinguPage, testRepoPath, fixture)

  const changedFile = kinguPage
    .locator('[data-testid="source-control-entry"]')
    .filter({ hasText: path.basename(GOLDEN_CHANGED_PATH) })
  await expect(changedFile).toBeVisible({ timeout: 15_000 })
  await changedFile.click()

  await expect(kinguPage.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  await expect(
    kinguPage
      .locator('.original-in-monaco-diff-editor .view-line')
      .filter({ hasText: GOLDEN_REMOVED_LINE })
  ).toBeVisible()
  await expect(
    kinguPage
      .locator('.modified-in-monaco-diff-editor .view-line')
      .filter({ hasText: GOLDEN_ADDED_LINE })
  ).toBeVisible()
  await expect(kinguPage.locator('.editor-header-path').first()).toHaveAttribute(
    'title',
    `${realpathSync(path.join(fixture.worktreePath, GOLDEN_CHANGED_PATH)).replaceAll('\\', '/')} (diff)`
  )

  const probe = kinguPage.getByRole('button', { name: /Source Control/ })
  await probe.focus()
  await expect(probe).toBeFocused()
})
