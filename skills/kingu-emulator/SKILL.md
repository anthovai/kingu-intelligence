---
name: kingu-emulator
description: >-
  iOS Simulator control from inside Kingu, with the live device view in Kingu's
  emulator pane. Use when driving a booted Apple Simulator on macOS: taps,
  gestures, typing, hardware buttons, rotation, and the accessibility tree, or
  when an iOS change needs simulator evidence. For an Android device or emulator
  use the Android emulator skill; build and install the app with xcodebuild or
  simctl first.
license: Apache-2.0
---

# Kingu Emulator

This discovery stub loads the version-matched guide from the Kingu executable used for this session.

Prefer Kingu over raw `serve-sim` or direct `simctl` for simulator control inside Kingu; it
handles device scoping, helper lifecycle, and worktree context.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `KINGU_CLI_COMMAND` environment variable is set, use its value. Kingu exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `KINGU_DEV_REPO_ROOT`, use `kingu-dev`.
- Otherwise, on Linux outside an Kingu-managed terminal, use `kingu-ide`. Never run bare
  `kingu` there — outside Kingu's terminals it normally resolves to the
  GNOME Kingu screen reader (`/usr/bin/kingu`) and starts speech on the user's machine.
- Otherwise, use `kingu`.

Below, `KINGU` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `KINGU` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Kingu build.

## Load the version-matched guide before running Kingu commands

```text
KINGU skills get kingu-emulator
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Kingu is not running, start it with `KINGU open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `KINGU open` or restart Kingu. If
`skills get` is unknown, explain that updating Kingu restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
