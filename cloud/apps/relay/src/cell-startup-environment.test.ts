import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadRelayConfig } from './config.js'

// A same-cap roll swaps only the image: the cell keeps the env its startup script already
// wrote. So every image must boot on exactly the variables that script renders, and a
// config change that needs a new variable is a template change, not an image-only roll.
const template = readFileSync(
  new URL('../../../infra/terraform/relay-gce-startup.sh.tftpl', import.meta.url),
  'utf8'
)

// One plausible production value per variable the template can write.
const RENDERED: Record<string, string> = {
  DATABASE_URL: 'postgres://relay@127.0.0.1:5432/kingu_relay',
  KINGU_RELAY_ASSIGNMENT_SIGNING_KEY: 'assignment-key-with-at-least-thirty-two-bytes',
  KINGU_RELAY_PUBLIC_URL: 'https://c25.relay.onkingu.dev',
  KINGU_RELAY_CELL_URL: 'https://c25.relay.onkingu.dev',
  KINGU_RELAY_AUTH_ISSUER: 'https://auth.onkingu.dev',
  KINGU_RELAY_AUTH_AUDIENCE: 'kingu-relay',
  KINGU_RELAY_JWKS_URL: 'https://auth.onkingu.dev/.well-known/jwks.json',
  KINGU_RELAY_ROLE: 'cell',
  KINGU_RELAY_CELL_ID: 'production-gce-c25',
  KINGU_RELAY_REGION: 'asia-east2',
  KINGU_RELAY_CELL_CAPACITY: '3000',
  KINGU_RELAY_DATABASE_POOL_MAX: '16',
  KINGU_RELAY_CELL_CONNECTION_HARD_CAP: '3000',
  KINGU_RELAY_CELL_CONNECTION_UNOBSERVED_BOUND: '60',
  KINGU_RELAY_CELLS_JSON: '[]',
  KINGU_RELAY_ADMIN_AUDIENCE: 'https://relay.onkingu.dev/v1/admin/drain',
  KINGU_RELAY_DEPLOY_SERVICE_ACCOUNT: 'deploy@example.iam.gserviceaccount.com',
  KINGU_RELAY_CAPACITY_SERVICE_ACCOUNT: 'capacity@example.iam.gserviceaccount.com',
  KINGU_RELAY_ASIA_PROOF_SERVICE_ACCOUNT: 'asia-proof@example.iam.gserviceaccount.com',
  KINGU_RELAY_RUNTIME_SERVICE_ACCOUNT: 'relay-cell@example.iam.gserviceaccount.com',
  KINGU_RELAY_REHOME_DIRECTOR_SERVICE_ACCOUNT: 'relay-director@example.iam.gserviceaccount.com',
  KINGU_RELAY_REHOME_AUDIENCE: 'https://relay.onkingu.dev/v1/admin/host-drain',
  KINGU_RELAY_DIRECTOR_URL: 'https://relay.onkingu.dev',
  KINGU_RELAY_HEARTBEAT_AUDIENCE: 'https://relay.onkingu.dev/v1/admin/cell-heartbeat',
  KINGU_RELAY_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`
}

const TEMPLATE_VARIABLES = [...template.matchAll(/printf '([A-Z0-9_]+)=/g)].map(([, name]) => name!)

describe('cell startup environment', () => {
  it('boots a cell on exactly the variables the startup template writes', () => {
    expect(TEMPLATE_VARIABLES.length).toBeGreaterThan(20)
    expect(TEMPLATE_VARIABLES.filter((name) => RENDERED[name] === undefined)).toEqual([])
    const env = Object.fromEntries(TEMPLATE_VARIABLES.map((name) => [name, RENDERED[name]]))
    expect(loadRelayConfig(env)).toMatchObject({
      role: 'cell',
      cellId: 'production-gce-c25',
      databaseUrl: RENDERED.DATABASE_URL
    })
  })
})
