import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const SELECTOR_NOTE =
  '--environment names a managed Kingu server this machine deployed over SSH (see `kingu environment list`); it is a selector here, not a routing flag.'
const DESKTOP_NOTE =
  'Runs on this machine’s Kingu desktop app, the same action as Settings > Managed servers. A runtime without the SSH registry (headless `kingu serve`) refuses it.'

export const MANAGED_SERVER_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['environment', 'status'],
    summary: 'Show a managed Kingu server’s active version, terminals and pending work',
    usage: 'kingu environment status --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE],
    examples: ['kingu environment status --environment build-box']
  },
  {
    path: ['environment', 'update'],
    summary: 'Update a managed Kingu server to this build’s version',
    usage: 'kingu environment update --environment <selector> [--force] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'force'],
    notes: [
      'Without --force, an update that would restart over running terminals is deferred and reported, not applied.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['kingu environment update --environment build-box']
  },
  {
    path: ['environment', 'rollback'],
    destructive: true,
    summary: 'Roll a managed Kingu server back to its previous version',
    usage: 'kingu environment rollback --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  },
  {
    path: ['environment', 'recover'],
    summary: 'Finish or undo a managed Kingu server’s interrupted update, rollback or stop',
    usage:
      'kingu environment recover --environment <selector> [--accept-changed-state --yes] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'accept-changed-state', 'yes'],
    notes: [
      'When a rejected build changed profile state, recover refuses rather than restart the previous build over it. --accept-changed-state --yes restores the prelaunch snapshot instead, the same as Restore in Settings > Managed servers; what the rejected build changed is discarded.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: [
      'kingu environment recover --environment build-box',
      'kingu environment recover --environment build-box --accept-changed-state --yes'
    ]
  },
  {
    path: ['environment', 'stop'],
    destructive: true,
    summary: 'Stop a managed Kingu server and unlink it from this machine (decommission)',
    usage: 'kingu environment stop --environment <selector> --yes [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'yes'],
    notes: [
      'Stops kingud on the SSH host and, once the host proves it exited, removes the server from this machine. Its terminals end. Requires --yes.',
      'If the host cannot prove kingud exited, the server stays linked and the refusal says why; nothing is removed on a guess. For a host that is gone for good, use `kingu environment forget`.',
      'If this server is the default host for new projects, choose another one first. `kingu environment cancel-stop` withdraws a stop kingud has not acted on yet.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['kingu environment stop --environment build-box --yes']
  },
  {
    path: ['environment', 'forget'],
    destructive: true,
    summary: 'Unlink a managed Kingu server whose SSH host is gone, without stopping it',
    usage: 'kingu environment forget --environment <selector> --yes [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'yes'],
    notes: [
      'Removes the server from this machine without contacting its host, so the SSH host can then be removed. Use it when the host was deleted or can never be reached again. Requires --yes.',
      'Nothing on the host is stopped: if it comes back, kingud may still be running there, and connecting to it again relinks it.',
      SELECTOR_NOTE,
      DESKTOP_NOTE
    ],
    examples: ['kingu environment forget --environment build-box --yes']
  },
  {
    path: ['environment', 'cancel-stop'],
    summary: 'Withdraw a managed Kingu server stop that kingud has not acted on yet',
    usage: 'kingu environment cancel-stop --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [SELECTOR_NOTE, DESKTOP_NOTE]
  }
]
