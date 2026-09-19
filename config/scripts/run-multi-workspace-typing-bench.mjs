/**
 * Entry point for the multi-workspace typing-latency bench
 * (tests/e2e/terminal-multi-workspace-typing-latency.spec.ts).
 *
 * Usage:
 *   pnpm bench:multi-workspace-typing [-- --panes 8 --rate-kbps 512 \
 *     --keys 48 --cadence-ms 250 --cpu-workers 4 --worktrees 870 \
 *     --repositories 27 --terminal-tabs 1410 --unified-tabs 2000 --label before-fix]
 *
 * Results land in tests/tools/benchmarks/results/multi-workspace-typing-*.json.
 * Run once per build/config with distinct --label values, then diff the
 * totalMs/inputHalfMs/echoHalfMs percentiles.
 */
import { spawn } from 'node:child_process'

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const knobByFlag = {
  '--visited-workspaces': 'KINGU_TYPING_BENCH_VISITED_WORKSPACES',
  '--load-workspaces': 'KINGU_TYPING_BENCH_LOAD_WORKSPACES',
  '--panes': 'KINGU_TYPING_BENCH_LOAD_PANES',
  '--rate-kbps': 'KINGU_TYPING_BENCH_RATE_KBPS',
  '--keys': 'KINGU_TYPING_BENCH_KEYS',
  '--cadence-ms': 'KINGU_TYPING_BENCH_KEY_CADENCE_MS',
  '--cpu-workers': 'KINGU_TYPING_BENCH_CPU_WORKERS',
  '--worktrees': 'KINGU_TYPING_BENCH_METADATA_WORKTREES',
  '--repositories': 'KINGU_TYPING_BENCH_METADATA_REPOSITORIES',
  '--terminal-tabs': 'KINGU_TYPING_BENCH_METADATA_TERMINAL_TABS',
  '--unified-tabs': 'KINGU_TYPING_BENCH_METADATA_UNIFIED_TABS',
  '--sleepers': 'KINGU_TYPING_BENCH_METADATA_SLEEPERS',
  '--live-statuses': 'KINGU_TYPING_BENCH_METADATA_LIVE_STATUSES',
  '--panes-per-tab': 'KINGU_TYPING_BENCH_METADATA_PANES',
  '--status-history': 'KINGU_TYPING_BENCH_METADATA_STATUS_HISTORY',
  '--status-interval-ms': 'KINGU_TYPING_BENCH_METADATA_STATUS_INTERVAL_MS',
  '--agent-rows': 'KINGU_TYPING_BENCH_AGENT_ROWS',
  '--title-change-ms': 'KINGU_TYPING_BENCH_TITLE_CHANGE_MS',
  '--lifecycle-ms': 'KINGU_TYPING_BENCH_LIFECYCLE_MS',
  '--cpu-profile': 'KINGU_TYPING_BENCH_CPU_PROFILE',
  '--pty-metadata': 'KINGU_TYPING_BENCH_PTY_METADATA',
  '--metadata-status': 'KINGU_TYPING_BENCH_METADATA_STATUS',
  '--metadata-titles': 'KINGU_TYPING_BENCH_METADATA_TITLES',
  '--instrumentation': 'KINGU_TYPING_BENCH_INSTRUMENTATION',
  '--graph-probe': 'KINGU_TYPING_BENCH_GRAPH_PROBE',
  '--cpu-throttle': 'KINGU_TYPING_BENCH_CPU_THROTTLE',
  '--label': 'KINGU_TYPING_BENCH_LABEL'
}

const env = { ...process.env, KINGU_BACKGROUND_LAUNCH: '1', KINGU_TYPING_BENCH: '1' }
const passthroughArgs = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--') {
    continue
  }
  const knob = knobByFlag[argv[i]]
  if (knob) {
    env[knob] = argv[++i]
  } else {
    passthroughArgs.push(argv[i])
  }
}

const child = spawn(
  npxCommand,
  [
    'playwright',
    'test',
    'tests/e2e/terminal-multi-workspace-typing-latency.spec.ts',
    '--config',
    'tests/playwright.config.ts',
    '--project',
    'electron-headless',
    '--workers=1',
    ...passthroughArgs
  ],
  { stdio: 'inherit', env }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
