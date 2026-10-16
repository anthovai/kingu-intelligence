import { describe, expect, it } from 'vitest'
import { KINGUD_TEMPLATE_TARGETS } from '../../src/shared/node-runtime-pin.ts'
import { requestedTemplateTargets } from './build-kingud-template.mjs'

describe('requestedTemplateTargets', () => {
  it('builds every target unless a subset is named', () => {
    expect(requestedTemplateTargets(['node', 'build-kingud-template.mjs'])).toEqual(
      KINGUD_TEMPLATE_TARGETS
    )
  })

  it('accepts a named subset once each', () => {
    expect(
      requestedTemplateTargets([
        'node',
        'build-kingud-template.mjs',
        '--targets',
        'linux-x64-glibc,linux-x64-musl,linux-x64-glibc'
      ])
    ).toEqual(['linux-x64-glibc', 'linux-x64-musl'])
  })

  it.each([[['--targets']], [['--targets', '']], [['--targets', 'linux-x64-glibc,sunos-sparc']]])(
    'refuses %j',
    (args) => {
      expect(() =>
        requestedTemplateTargets(['node', 'build-kingud-template.mjs', ...args])
      ).toThrow('--targets needs a comma-separated subset')
    }
  )
})
