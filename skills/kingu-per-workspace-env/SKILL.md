---
name: kingu-per-workspace-env
description: >-
  Set up, review, debug, or validate an Kingu per-workspace environment recipe: the
  on-demand, disposable runtime (cloud sandbox, VM, SSH host, or local container)
  Kingu creates fresh for each workspace. Use to stand up a new recipe end to end,
  fix an `environmentRecipes` entry in `kingu.yaml`, scaffold provider lifecycle
  scripts, or resolve an `kingu vm recipe doctor` failure. Use `kingu-cli` for
  ordinary worktree and workspace creation with no recipe involved.
---

# Per-Workspace Environments

This discovery stub loads the version-matched guide from the Kingu executable used for this session.

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
KINGU skills get kingu-per-workspace-env
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Kingu is not running, start it with `KINGU open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `KINGU open` or restart Kingu. If
`skills get` is unknown, explain that updating Kingu restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
