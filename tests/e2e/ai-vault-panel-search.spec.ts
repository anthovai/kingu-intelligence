import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/kingu-app'

test('panel consent enables real local transcript search; clearing restores history', async ({
  electronApp,
  kinguPage,
  seededRepoPath
}, testInfo) => {
  const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const directory = path.join(home, '.claude', 'projects', '-synthetic-pr7')
  mkdirSync(directory, { recursive: true })
  const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  writeFileSync(
    path.join(directory, `${sessionId}.jsonl`),
    `${[
      {
        type: 'user',
        sessionId,
        cwd: seededRepoPath,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'Synthetic panel transcript' }
      },
      {
        type: 'assistant',
        sessionId,
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          content: 'The nebulariver implementation handles <script>literal text</script> safely.'
        }
      }
    ]
      .map((record) => JSON.stringify(record))
      .join('\n')}\n`
  )
  await kinguPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setRightSidebarOpen(true)
    state?.setRightSidebarTab('vault')
    state?.setRightSidebarWidth(400)
  })
  await kinguPage.getByRole('button', { name: 'Agents', exact: true }).click()
  await kinguPage.getByRole('radio', { name: 'All', exact: true }).click()
  const input = kinguPage.getByRole('textbox', { name: 'Search sessions', exact: true })
  await input.fill('nebulariver')
  await expect(kinguPage.getByText('Enable full-text search?', { exact: false })).toBeVisible()
  const cdp = await kinguPage.context().newCDPSession(kinguPage)
  async function screenshot(name: string) {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const screenshotPath = testInfo.outputPath(name)
    writeFileSync(screenshotPath, Buffer.from(data, 'base64'))
    await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' })
  }
  await screenshot('consent.png')
  await kinguPage.getByRole('button', { name: 'Enable', exact: true }).click()
  // Indexed searches are snapshots; enabling starts indexing independently of the panel.
  await expect
    .poll(
      () =>
        kinguPage.evaluate(
          async () => (await window.api.aiVault.searchStatus('local')).filesIndexed
        ),
      { timeout: 30_000 }
    )
    .toBeGreaterThan(0)
  await kinguPage.getByRole('button', { name: 'Refresh Session History', exact: true }).click()
  await expect(kinguPage.locator('mark').filter({ hasText: 'nebulariver' })).toBeVisible()
  await expect(kinguPage.getByText('Synthetic panel transcript', { exact: true })).toBeVisible()
  await screenshot('results.png')
  await kinguPage.getByTitle('Drag to resume in a new tab', { exact: true }).click()
  await expect(kinguPage.locator('mark').filter({ hasText: 'nebulariver' })).toBeVisible()
  await kinguPage.getByTitle('Drag to resume in a new tab', { exact: true }).click()
  const title = kinguPage.getByText('Synthetic panel transcript', { exact: true })
  await expect(title).toHaveAttribute('draggable', 'true')
  const drag = await title.evaluate((element) => {
    const dataTransfer = new DataTransfer()
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    const payload = dataTransfer.getData('application/x-kingu-ai-vault-session')
    element.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }))
    return payload
  })
  expect(JSON.parse(drag)).toMatchObject({ sessionId, sessionExecutionHostId: 'local' })
  await title.click({ button: 'right' })
  await expect(
    kinguPage.getByRole('menuitem', { name: 'Copy Session ID', exact: true })
  ).toBeVisible()
  await kinguPage.keyboard.press('Escape')
  await expect(kinguPage.locator('[role="menu"]')).toHaveCount(0)
  await kinguPage.evaluate(async () => {
    await window.__store?.getState().updateSettingsOrThrow({ theme: 'dark' })
    window.__store?.getState().setRightSidebarWidth(280)
  })
  await expect(kinguPage.locator('html')).toHaveClass(/dark/)
  await screenshot('results-dark-narrow.png')
  await title.click({ button: 'right' })
  await kinguPage.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await kinguPage.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(title).toHaveCount(0)
  await expect(kinguPage.locator('mark')).toHaveCount(0)
  await input.fill('nothingmatchesprseven')
  await expect(
    kinguPage.getByText('No matching sessions in the indexed history.', { exact: false })
  ).toBeVisible()
  await screenshot('empty.png')
  await input.press('Escape')
  await expect(input).toHaveValue('')
  await expect(kinguPage.getByText('Indexed history · best matches', { exact: false })).toHaveCount(
    0
  )
  await cdp.detach()
})

test('panel renders transport failure and unavailable reasons without a local fallback', async ({
  electronApp,
  kinguPage
}, testInfo) => {
  await kinguPage.evaluate(async () => {
    await window.__store
      ?.getState()
      .updateSettingsOrThrow({ aiVaultSearch: { enabled: true, historyDays: null } })
    window.__store?.getState().setRightSidebarOpen(true)
    window.__store?.getState().setRightSidebarTab('vault')
  })
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('aiVault:searchSessions')
    ipcMain.handle('aiVault:searchSessions', () => {
      throw new Error('Synthetic transport failure')
    })
  })
  const input = kinguPage.getByRole('textbox', { name: 'Search sessions', exact: true })
  await input.fill('needle')
  await expect(
    kinguPage.getByText('Could not search this computer.', { exact: false })
  ).toBeVisible()
  await kinguPage.screenshot({ path: testInfo.outputPath('failure.png') })
  for (const reason of ['disabled', 'not-ready', 'no-service'] as const) {
    await electronApp.evaluate(({ ipcMain }, value) => {
      ipcMain.removeHandler('aiVault:searchSessions')
      ipcMain.handle('aiVault:searchSessions', () => ({ kind: 'unavailable', reason: value }))
    }, reason)
    await kinguPage.getByRole('button', { name: 'Try again', exact: true }).click()
    const copy =
      reason === 'disabled'
        ? 'Search is disabled on this computer.'
        : reason === 'not-ready'
          ? 'The search index is not ready yet.'
          : 'Search is unavailable on this computer.'
    await expect(kinguPage.getByText(copy, { exact: false })).toBeVisible()
  }
})
