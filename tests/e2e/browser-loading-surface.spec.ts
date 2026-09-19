import { expect, test } from './helpers/kingu-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { crashGuestRenderer } from './browser-guest-runtime-oracle'
import { observeBrowserLoadingSurface } from './browser-loading-surface-oracle'

test('browser host follows the theme before content and preserves the webpage canvas', async ({
  kinguPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await waitForActiveWorktree(kinguPage)
  const observations = await observeBrowserLoadingSurface(
    kinguPage,
    (name) => testInfo.outputPath(name),
    async (id) => {
      await crashGuestRenderer(electronApp, id)
    }
  )
  expect(observations.filter((entry) => !entry.pass)).toEqual([])
})
