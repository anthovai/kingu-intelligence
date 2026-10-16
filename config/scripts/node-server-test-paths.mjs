/** Mirrors KINGU_REQUIRED_TEST_INPUTS_ENV in src/main/kingud/kingud-node-slot-fixture.ts. */
export const REQUIRED_TEST_INPUTS_ENV = 'KINGU_REQUIRED_TEST_INPUTS'

// Need the pinned Bun and the last Bun kingud slot beside the built Node slot (design D7).
export const CROSS_RUNTIME_TEST_PATHS = [
  'src/main/kingud/kingud-cross-runtime-daemon-adoption.integration.test.ts',
  'src/main/persistence/profile-state/profile-state-cross-runtime.integration.test.ts'
]

// Need the built desktop server template; CI runs them by path after build-kingud-template.mjs.
export const TEMPLATE_TEST_PATHS = [
  'src/main/kingud/kingud-packaged-structured-chat.integration.test.ts'
]

export function nodeServerTestPaths({
  artifact = false,
  crossRuntime = false,
  template = false
} = {}) {
  return [
    'src/main/persistence/profile-state',
    'src/main/persistence/loading-store/profile-state',
    'src/main/sqlite',
    'src/main/kingud/kingud-entry.test.ts',
    'src/main/kingud/kingud-push-startup.test.ts',
    // The kingud server's identity and stop path, which Windows SSH hosts rely on (W2).
    'src/main/kingud/kingud-instance-lock.test.ts',
    'src/main/kingud/kingud-process-start-time.test.ts',
    'src/main/kingud/kingud-stop-request-listener.test.ts',
    'src/main/kingud/kingud-managed-stop.test.ts',
    'src/main/kingud/kingud-managed-stop-cancellation.test.ts',
    // The directory, not a prefix: its siblings are POSIX-host unit tests pr.yml already runs.
    'src/main/daemon/pty-subprocess/',
    'src/main/daemon/pty-subprocess-spawn-file-foreground.test.ts',
    'src/main/daemon/pty-subprocess-io-failure-native.test.ts',
    ...(artifact
      ? [
          'tests/e2e/daemon-running-work-probe.unit.test.ts',
          'src/shared/pty-running-work-probe.test.ts',
          'src/main/kingud/kingud-packaged-node-pty.integration.test.ts',
          'src/main/providers/agent-foreground-process-git-bash.win32.test.ts',
          'src/main/kingud/kingud-node-launcher.integration.test.ts',
          'src/main/kingud/kingud-cli-launcher.integration.test.ts',
          'src/main/kingud/kingud-cli-orchestration.integration.test.ts',
          'src/main/kingud/kingud-launcher-isolation.integration.test.ts',
          'src/main/kingud/kingud-stop-request-shutdown.integration.test.ts',
          'src/main/kingud/kingud-windows-conpty-breakaway.integration.test.ts',
          'src/main/kingud/kingud-serve-parity.integration.test.ts',
          'config/scripts/zip-extractor-command.test.mjs'
        ]
      : []),
    ...(crossRuntime ? CROSS_RUNTIME_TEST_PATHS : []),
    ...(template ? TEMPLATE_TEST_PATHS : [])
  ]
}
