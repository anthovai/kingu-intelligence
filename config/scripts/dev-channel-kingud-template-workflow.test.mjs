import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

// Why: every SSH host runs kingud, deployed from the template inside the desktop build, so a
// dev-channel build without it cannot connect to any SSH host.
function readWorkflow(name) {
  return parse(readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'))
}

const channels = [
  {
    name: 'hourly',
    workflow: readWorkflow('hourly-mac-build.yml'),
    macJob: 'build-hourly-mac',
    winJob: 'build-hourly-win',
    pinnedSha: '${{ needs.preflight.outputs.head_sha }}'
  },
  {
    name: 'daily',
    workflow: readWorkflow('daily-mac-build.yml'),
    macJob: 'build-daily-mac',
    winJob: 'build-daily-win',
    pinnedSha: '${{ needs.resolve-main.outputs.head_sha }}'
  }
]

describe.each(channels)('$name build ships the kingud template', (channel) => {
  const { jobs } = channel.workflow
  const mac = jobs[channel.macJob]
  const stepIndex = (predicate) => mac.steps.findIndex(predicate)

  it('builds the template from the commit the app is built from', () => {
    const template = jobs['kingud-template']
    expect(template.uses).toBe('./.github/workflows/node-server-tests.yml')
    expect(template.with).toEqual({ ref: channel.pinnedSha, build_template: true })
    expect(template.permissions).toEqual({ contents: 'read' })
    expect(template.secrets).toBeUndefined()
    expect(mac.steps.find((step) => step.name === 'Checkout').with.ref).toBe(channel.pinnedSha)
  })

  it('packages the macOS build only with the template present', () => {
    expect(mac.needs).toContain('kingud-template')
    // Implicit success(): a failed template job must skip the signed build.
    expect(mac.if ?? '').not.toMatch(/always\(\)|!cancelled\(\)/)
    const build = stepIndex((step) => step.name === 'Build app')
    const download = stepIndex((step) => step.name === 'Download the kingud deployment template')
    const publish = stepIndex((step) => step.with?.command?.includes('electron-builder'))
    expect(build).toBeGreaterThanOrEqual(0)
    expect(download).toBeGreaterThan(build)
    expect(publish).toBeGreaterThan(download)
    expect(mac.steps[download].uses).toMatch(/^actions\/download-artifact@/)
    expect(mac.steps[download].with).toEqual({
      name: 'kingud-template',
      path: 'out/kingud-template'
    })
    expect(mac.steps[publish].env.KINGU_REQUIRE_KINGUD_TEMPLATE).toBe('1')
  })

  it('ships the same template in the Windows build', () => {
    expect(jobs[channel.winJob].uses).toBe('./.github/workflows/dev-channel-win-build.yml')
    expect(jobs[channel.winJob].with.kingud_template).toBe(true)
  })
})
