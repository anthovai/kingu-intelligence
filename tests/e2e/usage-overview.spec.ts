import { test, expect } from './helpers/kingu-app'
import { getStoreState, waitForSessionReady } from './helpers/store'

test.describe('usage overview', () => {
  test.beforeEach(async ({ kinguPage }) => {
    await waitForSessionReady(kinguPage)
  })

  test('Stats & Usage opens on the combined overview with provider controls', async ({
    kinguPage
  }) => {
    await kinguPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsPage()
    })

    await expect
      .poll(async () => getStoreState<string>(kinguPage, 'activeView'), { timeout: 5_000 })
      .toBe('settings')
    await kinguPage.getByRole('button', { name: 'Stats & Usage' }).click()
    await expect(kinguPage.getByRole('heading', { name: 'Usage Analytics' })).toBeVisible()
    const providerDropdown = kinguPage.getByTestId('usage-provider-select')
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: Overview'
    )
    await expect(kinguPage.getByTestId('usage-overview-pane')).toBeVisible()
    await expect(kinguPage.getByRole('heading', { name: 'Usage Overview' })).toBeVisible()
    await expect(kinguPage.getByRole('heading', { name: 'Providers' })).toBeVisible()
    await expect(kinguPage.getByRole('button', { name: 'Enable Claude' })).toBeVisible()
    await expect(kinguPage.getByRole('button', { name: 'Enable Codex' })).toBeVisible()
    await expect(kinguPage.getByRole('button', { name: 'Enable OpenCode' })).toBeVisible()

    await providerDropdown.click()
    await kinguPage.getByRole('menuitem', { name: 'Codex', exact: true }).click()
    await expect(kinguPage.getByRole('heading', { name: 'Codex Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute('aria-label', 'Usage analytics provider: Codex')

    await providerDropdown.click()
    await kinguPage.getByRole('menuitem', { name: 'OpenCode', exact: true }).click()
    await expect(kinguPage.getByRole('heading', { name: 'OpenCode Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: OpenCode'
    )
  })
})
