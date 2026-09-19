import { expect, test } from './helpers/kingu-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Why: xterm renders the typed command itself, so `echo after-agent` would
// satisfy waitForTerminalOutput even if the shell never ran it. Splitting the
// marker keeps it out of the input, so a match proves real shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ kinguPage }) => {
  await waitForSessionReady(kinguPage)
  await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await configureGoldenStubAgent(kinguPage)
  await launchGoldenStubAgentFromNewTab(kinguPage)

  await kinguPage.keyboard.type('exit')
  await kinguPage.keyboard.press('Enter')
  await waitForTerminalOutput(kinguPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await kinguPage.locator('[data-testid="sortable-tab"]').count()
  await kinguPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await kinguPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(kinguPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(kinguPage)
  // Why: a bound ptyId only means the pane exists; the renderer transport can
  // still drop keystrokes until it connects, which would strand the markers.
  expect(await waitForRestoredTerminalInputReady(kinguPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(kinguPage)
  await kinguPage.keyboard.type(afterAgent.command)
  await kinguPage.keyboard.press('Enter')
  await waitForTerminalOutput(kinguPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await kinguPage.keyboard.press('Shift+Enter')
  await kinguPage.keyboard.type(afterShiftEnter.command)
  await kinguPage.keyboard.press('Enter')
  await waitForTerminalOutput(kinguPage, afterShiftEnter.marker, 15_000)
  await expect(kinguPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
