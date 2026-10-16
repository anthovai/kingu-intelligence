/**
 * Agent browser input must reach its page without touching the user's keyboard focus (#20595).
 * Runs hidden; browser-agent-input-focus-isolation-native.spec.ts repeats it in a visible window.
 */

import { test } from './helpers/kingu-app'
import {
  runAgentClicksScenario,
  runAgentCrossSiteFrameScenario,
  runAgentKeysScenario,
  runAgentShortcutsScenario
} from './helpers/browser-agent-focus-scenarios'

test('agent keys and text reach the page without leaving the user’s terminal', async ({
  kinguPage
}) => {
  test.setTimeout(120_000)
  await runAgentKeysScenario(kinguPage)
})

test('agent clicks and presses reach the page without leaving the user’s terminal', async ({
  kinguPage
}) => {
  test.setTimeout(120_000)
  await runAgentClicksScenario(kinguPage)
})

test('agent shortcut keys stay in the page instead of running Kingu shortcuts', async ({
  kinguPage
}) => {
  test.setTimeout(120_000)
  await runAgentShortcutsScenario(kinguPage)
})

test('agent keys and text reach a focused cross-site frame without moving the user’s focus', async ({
  kinguPage
}) => {
  test.setTimeout(120_000)
  await runAgentCrossSiteFrameScenario(kinguPage)
})
