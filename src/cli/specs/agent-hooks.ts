import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: 'Repair Kingu-managed Codex hook trust before a shell launch',
    usage: 'kingu agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Kingu-managed agent status hooks are enabled',
    usage: 'kingu agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kingu agent hooks status', 'kingu agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Kingu-managed agent status hooks and remove local hook entries',
    usage: 'kingu agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kingu agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Kingu-managed agent status hooks',
    usage: 'kingu agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kingu agent hooks on']
  }
]
