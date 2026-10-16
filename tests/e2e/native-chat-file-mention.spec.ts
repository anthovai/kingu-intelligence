import { test, expect } from './helpers/kingu-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { showActivePaneAsNativeChat } from './helpers/native-chat-view'
import { waitForActiveTerminalManager } from './helpers/terminal'

test('typing @ in the chat composer lists workspace files and inserts the chosen one', async ({
  kinguPage
}, testInfo) => {
  await waitForSessionReady(kinguPage)
  await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await waitForActiveTerminalManager(kinguPage)
  await showActivePaneAsNativeChat(kinguPage, 'claude', 'Claude')

  const composer = kinguPage.getByRole('textbox', {
    name: 'Ask anything, @ to mention files, / for commands',
    exact: true
  })
  await expect(composer).toBeVisible()
  await composer.click()

  await kinguPage.keyboard.type('review @')
  // The sidebar's worktree list is a listbox too.
  const files = kinguPage.locator('[role="listbox"][id^="native-chat-picker-"]')
  await expect(files.getByRole('option', { name: /README\.md/ })).toBeVisible()
  await kinguPage.screenshot({ path: testInfo.outputPath('mention-all-files.png') })

  await kinguPage.keyboard.type('index')
  const match = files.getByRole('option', { name: /index\.ts/ })
  await expect(match).toHaveAttribute('aria-selected', 'true')
  await expect(files.getByRole('option', { name: /README\.md/ })).toHaveCount(0)
  await kinguPage.screenshot({ path: testInfo.outputPath('mention-filtered.png') })

  await kinguPage.keyboard.press('Enter')
  await expect(composer).toHaveText('review @src/index.ts ')
  await expect(files).toHaveCount(0)

  await kinguPage.keyboard.type('@zzz-no-such-file')
  await expect(files).toContainText('No matching files')
  // A one-off app tooltip can be open and takes the first Escape for itself.
  await expect(async () => {
    await kinguPage.keyboard.press('Escape')
    await expect(files).toHaveCount(0, { timeout: 1000 })
  }).toPass()
  await kinguPage.keyboard.type('x')
  await expect(composer).toContainText('@zzz-no-such-filex')
  await expect(files).toHaveCount(0)
  await kinguPage.keyboard.type(' @')
  await expect(files.getByRole('option', { name: /README\.md/ })).toBeVisible()
})
