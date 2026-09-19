import { expect, test } from './helpers/kingu-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  kinguPage
}) => {
  await waitForSessionReady(kinguPage)
  await waitForActiveWorktree(kinguPage)
  await openFileExplorer(kinguPage)

  const readmeRow = kinguPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(kinguPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(kinguPage, 'f')

  await expect(
    kinguPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
