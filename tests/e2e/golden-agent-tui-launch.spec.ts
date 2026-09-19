import { expect, test } from './helpers/kingu-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { focusActiveTerminalInput, getTerminalContent } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('launches an agent TUI with a live multiline composer', async ({ kinguPage }) => {
  await waitForSessionReady(kinguPage)
  await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await configureGoldenStubAgent(kinguPage)
  await launchGoldenStubAgentFromNewTab(kinguPage)

  const activeTab = kinguPage.locator('[data-testid="sortable-tab"][data-active="true"]')
  await expect(activeTab).toHaveAttribute('data-tab-title', /Codex|Golden Stub Agent/i)

  await focusActiveTerminalInput(kinguPage)
  await kinguPage.keyboard.type('hello from e2e')
  await kinguPage.keyboard.press('Shift+Enter')
  await kinguPage.keyboard.type('second line')

  await expect
    .poll(() => getTerminalContent(kinguPage), { timeout: 10_000 })
    .toContain('> hello from e2e\r\n  second line')
  expect(await getTerminalContent(kinguPage)).not.toContain('GOLDEN_STUB_AGENT_SUBMITTED')
})
