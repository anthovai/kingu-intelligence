/**
 * End-to-end coverage for the Automations runs surface.
 *
 * The test intentionally does not depend on seeded run history: a fresh E2E
 * profile may have no automations, but the Runs navigation and empty state must
 * still be usable.
 */

import { test, expect } from './helpers/kingu-app'
import { waitForSessionReady } from './helpers/store'

test('opens the runs dashboard and returns to automations', async ({ kinguPage }) => {
  await waitForSessionReady(kinguPage)

  await kinguPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().openAutomationsPage()
  })

  const runsButton = kinguPage.getByRole('button', { name: 'Runs' })
  await expect(runsButton).toBeVisible()
  await runsButton.click()

  await expect(kinguPage.getByRole('navigation', { name: 'Automations breadcrumb' })).toBeVisible()
  await expect(kinguPage.getByText('Successful · 24h')).toBeVisible()
  await expect(kinguPage.getByText('Failed · 24h')).toBeVisible()
  await expect(kinguPage.getByText('Successful · 7d')).toBeVisible()
  await expect(kinguPage.getByText('Failed · 7d')).toBeVisible()
  await expect(kinguPage.getByRole('button', { name: 'Filters' })).toBeVisible()
  await expect(kinguPage.getByRole('button', { name: 'Refresh runs' })).toBeVisible()
  await expect(kinguPage.getByText('Automation', { exact: true })).toBeVisible()
  await expect(kinguPage.getByText('Triggered', { exact: true })).toBeVisible()
  await expect(kinguPage.getByText('Status', { exact: true })).toBeVisible()

  await kinguPage
    .getByRole('navigation', { name: 'Automations breadcrumb' })
    .getByRole('button', { name: 'Automations' })
    .click()
  await expect(kinguPage.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(runsButton).toBeVisible()
})
