import { readFileSync } from 'node:fs'
import { matchesGlob } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflows = {
  windows: parse(
    readFileSync(
      new URL('../../.github/workflows/win-kingud-serve-switch-e2e.yml', import.meta.url),
      'utf8'
    )
  ),
  wsl: parse(
    readFileSync(new URL('../../.github/workflows/wsl-kingud-e2e.yml', import.meta.url), 'utf8')
  )
}

function workflowIncludes(paths, files) {
  return files.some((file) =>
    paths.reduce((included, pattern) => {
      const excluded = pattern.startsWith('!')
      return matchesGlob(file, excluded ? pattern.slice(1) : pattern) ? !excluded : included
    }, false)
  )
}

const cases = {
  windows: {
    excluded: [
      'src/main/daemon/daemon-server.test.ts',
      'src/main/kingud/kingud-native-preflight.test.ts',
      'src/main/kingud/nested/kingud-launch.test.ts',
      'src/cli/runtime/serve.test.ts',
      'src/cli/runtime/nested/serve.test.ts'
    ],
    retained: [
      'src/main/daemon/daemon-entry.ts',
      'src/main/daemon/daemon-init-dependency-mocks.ts',
      'src/main/kingud/main.ts',
      'src/main/kingud/launcher.ts',
      'src/main/kingud/kingud-node-slot-fixture.ts',
      'src/main/kingud/kingud.test-fixture.ts',
      'src/main/kingud/__fixtures__/fake-kingud-electron-sidecar.cjs',
      'src/main/kingud/kingud.test.json',
      'src/cli/runtime/serve.ts',
      'src/cli/runtime/serve-test-harness.ts',
      'src/shared/kingud-local-serve-selection.ts',
      'tests/tools/win-update-e2e/serve-switch.mjs',
      '.github/workflows/win-kingud-serve-switch-e2e.yml'
    ],
    product: 'src/main/kingud/main.ts'
  },
  wsl: {
    excluded: [
      'src/main/wsl/wsl-kingud-deploy.test.ts',
      'src/main/wsl/nested/wsl-kingud-deploy.test.ts',
      'src/main/ssh/kingud-activation-outcome-log.test.ts',
      'src/main/ssh/kingud-remote-shell-commands.integration.test.ts'
    ],
    retained: [
      'src/main/wsl/wsl-kingud-real-distro-lane.test.ts',
      'src/main/wsl/wsl-kingud-deploy.ts',
      'src/main/wsl/wsl-kingud-bridge-test-child.ts',
      'src/main/wsl/wsl-kingud.test-fixture.ts',
      'src/main/wsl/wsl-kingud.test.json',
      'src/main/ssh/kingud-remote-launch.ts',
      'src/main/ssh/kingud-launch-test-harness.ts',
      'src/main/ssh/kingud-launch.test-fixture.ts',
      'src/main/ssh/remote-install-transport.ts',
      '.github/workflows/wsl-kingud-e2e.yml'
    ],
    product: 'src/main/wsl/wsl-kingud-deploy.ts'
  }
}

for (const [lane, { excluded, retained, product }] of Object.entries(cases)) {
  describe(`${lane} Kingud E2E change routing`, () => {
    const workflow = workflows[lane]
    const paths = workflow.on.pull_request.paths

    it.each(excluded)('omits a changed or deleted unit root: %s', (file) => {
      expect(workflowIncludes(paths, [file])).toBe(false)
      expect(workflowIncludes(paths, [file, 'docs/ci.md'])).toBe(false)
      expect(workflowIncludes(paths, [file, product])).toBe(true)
      // A rename retains both names, including its product source or destination.
      expect(workflowIncludes(paths, [file, file.replace('.test.ts', '.ts')])).toBe(true)
      expect(workflowIncludes(paths, [file.replace('.test.ts', '.ts'), file])).toBe(true)
    })

    it.each(retained)('retains a changed or deleted lane input: %s', (file) => {
      expect(workflowIncludes(paths, [file])).toBe(true)
    })

    it('keeps explicit manual runs available', () => {
      expect(workflow.on).toHaveProperty('workflow_dispatch')
    })
  })
}

it('re-includes the real WSL distro root after excluding unit tests', () => {
  const paths = workflows.wsl.on.pull_request.paths
  const exclude = paths.indexOf('!src/main/wsl/**/*.test.ts')
  expect(exclude).toBeGreaterThan(paths.indexOf('src/main/wsl/**'))
  expect(paths.indexOf('src/main/wsl/wsl-kingud-real-distro-lane.test.ts')).toBeGreaterThan(exclude)
  const steps = workflows.wsl.jobs.wsl2.steps
  const phases = steps.filter((step) => step.env?.KINGU_RUN_WSL_KINGUD_LANE === '1')
  expect(phases.map((step) => step.env.KINGU_WSL_KINGUD_LANE_PHASE)).toEqual(['launch', 'survive'])
  for (const phase of phases) {
    expect(phase.run).toContain('src/main/wsl/wsl-kingud-real-distro-lane.test.ts')
  }
})
