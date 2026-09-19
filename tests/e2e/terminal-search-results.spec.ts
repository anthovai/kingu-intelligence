import { test, expect } from './helpers/kingu-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('terminal search counts real matches and repeat find selects the query', async ({
  kinguPage
}, testInfo) => {
  await waitForSessionReady(kinguPage)
  await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await waitForActiveTerminalManager(kinguPage, 30_000)
  const ptyId = await waitForActivePanePtyId(kinguPage)
  for (let line = 0; line < 3; line++) {
    await execInTerminal(kinguPage, ptyId, 'echo kingu-search-proof')
  }
  await expect
    .poll(
      async () =>
        (await getTerminalContent(kinguPage))
          .split(/\r?\n/)
          .filter((line) => line.trim() === 'kingu-search-proof').length
    )
    .toBe(3)
  await focusActiveTerminalInput(kinguPage)
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await kinguPage.keyboard.press(`${modifier}+f`)
  const search = kinguPage.locator('[data-terminal-search-root]')
  const input = search.locator('input')
  await expect(input).toBeFocused()
  await search.getByTitle('Regex', { exact: true }).click()
  const query = '^kingu-search-proof$'
  await input.fill(query)
  await expect(search).toContainText(/[1-3]\/3/)
  const initialCount = await search.innerText()
  await input.press('Enter')
  await expect.poll(() => search.innerText()).not.toBe(initialCount)
  await kinguPage.screenshot({ path: testInfo.outputPath('search-results.png') })
  await input.press('ArrowLeft')
  await kinguPage.keyboard.press(`${modifier}+f`)
  await expect(input).toBeFocused()
  await expect
    .poll(() =>
      input.evaluate((element) => ({ start: element.selectionStart, end: element.selectionEnd }))
    )
    .toEqual({ start: 0, end: query.length })
  await kinguPage.screenshot({ path: testInfo.outputPath('search-query-selected.png') })
  await input.fill('no-such-search-result-314159')
  await expect(search).toContainText('No results')
  await input.press('Escape')
  await expect(search).toBeHidden()
})
