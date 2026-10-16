/**
 * A second kingud template that differs from the first only in its build identity, so a relaunch
 * with it stands in for an app update that bundles a newer kingud.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  KINGUD_TEMPLATE_MANIFEST_FILENAME,
  KINGUD_VERSION
} from '../../../src/shared/kingud-artifacts'

const ENTRY = 'kingud.js'

/** Rewrites `templateDir` in place; its manifest keeps verifying. */
export function makeKingudTemplateVariant(templateDir: string, tag: string): void {
  const entry = path.join(templateDir, ENTRY)
  appendFileSync(entry, `\n// kingud e2e template variant ${tag}\n`)
  const manifestPath = path.join(templateDir, KINGUD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.commonSha256[ENTRY] = createHash('sha256').update(readFileSync(entry)).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The host's activation record, read the way a client reads it. */
export function readHostKingudActivation(exec: (command: string) => string): {
  active?: string
  previous?: string
  activeAppVersion?: string
} {
  return JSON.parse(exec('cat "$HOME/.kingu-remote/kingud-active.json"'))
}

export function isKingudFullVersion(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${KINGUD_VERSION}+`)
}
