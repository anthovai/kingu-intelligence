import { test } from './helpers/kingu-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedWebClient
} from './helpers/paired-electron-client'
import { runPairedTerminalParkingOracle } from './helpers/paired-terminal-parking-oracle'

test('ordinary-parks paired terminals and restores authoritative host scrollback @headful', async ({
  electronApp,
  kinguPage
}) => {
  test.setTimeout(240_000)
  const seed = await kinguPage.evaluate(() => {
    const state = window.__store?.getState()
    const worktrees = state?.allWorktrees() ?? []
    const active = worktrees.find((worktree) => worktree.id === state?.activeWorktreeId)
    if (!active) {
      throw new Error('Paired retention host has no active seeded worktree')
    }
    return { activeWorktreeId: active.id, repoId: active.repoId }
  })
  const offer = await createRuntimeDesktopPairingOffer(kinguPage)
  const client = await launchPairedWebClient(electronApp, offer, {
    terminalParkingDelayMs: 100
  })
  try {
    await runPairedTerminalParkingOracle(
      client.page,
      {
        fallbackWorktreeId: seed.activeWorktreeId,
        repoId: seed.repoId
      },
      { hostPage: kinguPage }
    )
  } finally {
    await client.dispose()
  }
})
