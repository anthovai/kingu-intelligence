# Built-in browser commands

Use a snapshot-interact-re-snapshot loop:

```text
KINGU goto --url https://example.com --json
KINGU snapshot --json
KINGU click --element @e3 --json
KINGU snapshot --json
```

Common commands:

```text
KINGU goto --url <url> --json
KINGU back --json
KINGU reload --json
KINGU snapshot --json
KINGU screenshot --json
KINGU full-screenshot --json
KINGU pdf --json
KINGU click --element <ref> --json
KINGU fill --element <ref> --value <text> --json
KINGU type --input <text> --json
KINGU select --element <ref> --value <value> --json
KINGU check --element <ref> --json
KINGU scroll --direction down --amount 1000 --json
KINGU hover --element <ref> --json
KINGU focus --element <ref> --json
KINGU keypress --key Enter --json
KINGU upload --element <ref> --files <paths> --json
KINGU wait --text <text> --json
KINGU wait --url <substring> --json
KINGU wait --selector <css> --json
KINGU wait --load networkidle --json
KINGU eval --expression <js> --json
KINGU tab list --json
KINGU tab create --url <url> --json
KINGU tab switch --index <n> --json
KINGU tab close --index <n> --json
KINGU cookie get --json
KINGU capture start --json
KINGU console --limit 50 --json
KINGU network --limit 50 --json
KINGU exec --command "help" --json
```

Browser rules:

- Re-snapshot after navigation, tab switches, clicks that change the page, and any `browser_stale_ref`.
- Refs like `@e1` are assigned by `snapshot`, scoped to one tab, and invalidated by navigation or tab switch.
- Browser commands default to the current worktree and its active tab. Use `--worktree all` only intentionally.
- For concurrent browser work, run `KINGU tab list --json`, read `tabs[].browserPageId`, and pass `--page <browserPageId>` on later commands.
- Use typed tab commands (`KINGU tab list/create/close/switch`), not `KINGU exec --command "tab ..."`, so Kingu keeps UI state synchronized.
- Prefer `wait --text`, `--url`, `--selector`, or `--load` after async page changes instead of bare timeouts.
- Anything not listed above goes through `KINGU exec --command "<agent-browser command>"`.
- If `fill` or `type` fails on a custom input, try `KINGU focus --element @e1 --json` then `KINGU inserttext --text "text" --json`.
- A client-hosted page renders in the paired desktop's browser engine, so every command against it needs that desktop online and returns `browser_host_unavailable` while it is closed, asleep, or disconnected. Server-hosted pages run with no desktop attached; prefer them for long or unattended automation.

Common recoveries:

- `browser_no_tab`: open a tab with `KINGU tab create --url <url> --json`.
- `browser_stale_ref`: run `KINGU snapshot --json` and retry with fresh refs.
- `browser_tab_not_found`: run `KINGU tab list --json` before switching or closing.
- `browser_host_unavailable`: the desktop hosting the page is offline. Bring it back, or recreate the page with server placement if the work must outlive the desktop session.
