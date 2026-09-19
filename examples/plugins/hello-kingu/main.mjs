// Sample Kingu plugin worker entry. Runs inside the out-of-process plugin
// worker (plain Node, no Electron), forked lazily on the first trigger. The
// default export receives the `kingu` API: command registration, event
// handlers, and the capability-gated host API.
export default function activate(kingu) {
  kingu.commands.register('hello-ping', async (args) => {
    const stored = await kingu.host.call('storage.get', { key: 'pings' })
    const count = (typeof stored?.value === 'number' ? stored.value : 0) + 1
    await kingu.host.call('storage.set', { key: 'pings', value: count })
    return { pong: true, count, args: args ?? null }
  })

  kingu.events.on('worktree.created', async (payload) => {
    kingu.log(`worktree created: ${payload.worktreeId} at ${payload.path}`)
    await kingu.host.call('notifications.show', {
      title: 'Worktree created',
      body: payload.path
    })
  })

  kingu.events.on('agent.status.changed', (payload) => {
    kingu.log(`agent status: ${payload.state} in ${payload.worktreeId ?? 'unknown worktree'}`)
  })
}
