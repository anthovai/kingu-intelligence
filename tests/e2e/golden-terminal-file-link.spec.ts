import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@anthovai/playwright-test'
import { expect, test } from './helpers/kingu-app'
import { openFileExplorer } from './helpers/file-explorer'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  getTerminalContent,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { nodeTerminalCommand } from './terminal-node-command'
import { waitForPtyShellEcho } from './terminal-pty-readiness'

type LinkProbe = { col: number; row: number; tabId: string }
type LinkClientPoint = { x: number; y: number }

const LINK_SCAN_CHAR_LIMIT = 12_000

function canonicalFileIdentity(value: string): string {
  const normalized = path.resolve(value).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function locateLink(page: Page, needle: string): Promise<LinkProbe | null> {
  return page.evaluate((needle) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? state?.activeTabIdByWorktree?.[worktreeId]
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    if (!tabId || !pane) {
      return null
    }
    const buffer = pane.terminal.buffer.active
    // Preserve fixed-width cells so paths split across xterm rows stay searchable.
    const visibleCells = Array.from({ length: pane.terminal.rows }, (_, row) =>
      (buffer.getLine(buffer.viewportY + row)?.translateToString(false) ?? '').padEnd(
        pane.terminal.cols
      )
    ).join('')
    const start = visibleCells.indexOf(needle)
    if (start !== -1) {
      const center = start + Math.floor(needle.length / 2)
      return {
        col: center % pane.terminal.cols,
        row: Math.floor(center / pane.terminal.cols),
        tabId
      }
    }
    return null
  }, needle)
}

async function linkClientPoint(page: Page, probe: LinkProbe): Promise<LinkClientPoint> {
  return page.evaluate(({ col, row, tabId }) => {
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen')
    if (!pane || !screen) {
      throw new Error('terminal link surface unavailable')
    }
    const rect = screen.getBoundingClientRect()
    return {
      x: rect.left + (col + 0.5) * (rect.width / pane.terminal.cols),
      y: rect.top + (row + 0.5) * (rect.height / pane.terminal.rows)
    }
  }, probe)
}

async function hoverLink(page: Page, probe: LinkProbe): Promise<string | null> {
  const point = await linkClientPoint(page, probe)
  return page.evaluate(
    ({ tabId, x, y }) => {
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
      const screen = pane?.terminal.element?.querySelector<HTMLElement>('.xterm-screen')
      if (!pane || !screen) {
        throw new Error('terminal link surface unavailable')
      }
      screen.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y })
      )
      const terminal = pane.terminal as unknown as {
        _core?: { linkifier?: { currentLink?: { link?: { text?: string } } } }
      }
      return terminal._core?.linkifier?.currentLink?.link?.text ?? null
    },
    { tabId: probe.tabId, ...point }
  )
}

async function clickLink(page: Page, probe: LinkProbe): Promise<void> {
  const target = await linkClientPoint(page, probe)
  await page.mouse.move(target.x, target.y)
  await page.mouse.click(target.x, target.y)
}

test('opens a terminal file link and observes an external edit @golden', async ({ kinguPage }) => {
  test.setTimeout(180_000)
  await waitForSessionReady(kinguPage)
  const worktreeId = await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await waitForActiveTerminalManager(kinguPage, 30_000)
  const ptyId = await waitForActivePanePtyId(kinguPage)
  await waitForPtyShellEcho(kinguPage, ptyId, 15_000)

  const worktreePath = await kinguPage.evaluate((id) => {
    return (
      Object.values(window.__store?.getState().worktreesByRepo ?? {})
        .flat()
        .find((worktree) => worktree.id === id)?.path ?? ''
    )
  }, worktreeId)
  const filePath = path.join(worktreePath, 'package.json')
  const original = readFileSync(filePath, 'utf8')
  const resolvedDestination =
    process.platform === 'win32' ? filePath.replaceAll('\\', '/') : filePath
  // Why: Mac/Windows tmp paths soft-wrap across xterm rows; locateLink only
  // indexOf's each physical row, so print a cwd-relative path that stays on one.
  const printedPath = './package.json'
  const changedMarker = `golden-external-edit-${Date.now()}`

  try {
    await openFileExplorer(kinguPage)
    const explorerRow = kinguPage
      .locator('[data-file-explorer-row]')
      .filter({ hasText: 'package.json' })
      .first()
    await expect(explorerRow).toBeVisible({ timeout: 15_000 })

    const command = nodeTerminalCommand(['-e', `console.log(${JSON.stringify(printedPath)})`])
    await sendToTerminal(kinguPage, ptyId, `${command}\r`)
    await expect
      .poll(() => getTerminalContent(kinguPage, LINK_SCAN_CHAR_LIMIT), { timeout: 15_000 })
      .toContain(printedPath)

    let probe: LinkProbe | null = null
    await expect
      .poll(
        async () => {
          probe = await locateLink(kinguPage, printedPath)
          return probe ? hoverLink(kinguPage, probe) : null
        },
        { timeout: 10_000, message: 'cwd-relative file path did not become clickable' }
      )
      .toContain('package.json')
    if (!probe) {
      throw new Error('terminal file link disappeared before activation')
    }
    await clickLink(kinguPage, probe)

    const actionPopover = kinguPage.locator('[data-terminal-link-action-popover]')
    await expect(actionPopover).toBeVisible()
    // Why: destination is the resolved absolute path; Windows may use `\`.
    await expect
      .poll(
        async () =>
          (
            (await actionPopover.locator('[data-terminal-link-destination]').textContent()) ?? ''
          ).replaceAll('\\', '/'),
        { message: 'terminal link destination did not resolve to package.json' }
      )
      .toContain(resolvedDestination)
    await actionPopover.getByRole('button', { name: /Open file/i }).click()

    const editorHeader = kinguPage.locator('.editor-header-path').first()
    await expect(editorHeader).toContainText('package.json', { timeout: 20_000 })
    await expect(explorerRow).toHaveAttribute('data-selected', 'true', { timeout: 10_000 })
    await expect
      .poll(
        async () =>
          canonicalFileIdentity(
            (await kinguPage.evaluate(() => window.__monacoEditorE2E?.filePath)) ?? ''
          ),
        { timeout: 20_000, message: 'Monaco opened a different file identity' }
      )
      .toBe(canonicalFileIdentity(filePath))

    writeFileSync(filePath, `${original.trimEnd()}\n\n${changedMarker}\n`)
    await expect
      .poll(
        async () => {
          const snapshot = await kinguPage.evaluate(() => window.__monacoEditorE2E?.snapshot())
          const reloadVisible = await kinguPage
            .getByRole('button', { name: 'Reload from Disk' })
            .isVisible()
            .catch(() => false)
          return Boolean(snapshot?.valueTail.includes(changedMarker) || reloadVisible)
        },
        { timeout: 20_000, message: 'editor stayed silently stale after the external edit' }
      )
      .toBe(true)
  } finally {
    writeFileSync(filePath, original)
  }
})

test('reuses a terminal file link already open in a sibling workspace @golden', async ({
  kinguPage
}) => {
  test.setTimeout(180_000)
  await waitForSessionReady(kinguPage)
  const sourceWorktreeId = await waitForActiveWorktree(kinguPage)
  const worktrees = await kinguPage.evaluate((sourceId) => {
    const state = window.__store?.getState()
    const entries = Object.values(state?.worktreesByRepo ?? {}).flat()
    return {
      source: entries.find((worktree) => worktree.id === sourceId) ?? null,
      sibling: entries.find((worktree) => worktree.id !== sourceId) ?? null
    }
  }, sourceWorktreeId)
  const { source, sibling } = worktrees
  if (!source) {
    throw new Error('source worktree fixture unavailable')
  }
  if (!sibling) {
    throw new Error('sibling worktree fixture unavailable')
  }

  const filePath = path.join(sibling.path, 'package.json')
  await kinguPage.evaluate(
    ({ filePath, sourceWorktreeId, siblingWorktreeId }) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('store unavailable')
      }
      state.openFile({
        filePath,
        relativePath: 'package.json',
        worktreeId: siblingWorktreeId,
        runtimeEnvironmentId: null,
        language: 'json',
        mode: 'edit'
      })
      state.setActiveWorktree(sourceWorktreeId)
    },
    { filePath, sourceWorktreeId, siblingWorktreeId: sibling.id }
  )

  await ensureTerminalVisible(kinguPage)
  await waitForActiveTerminalManager(kinguPage, 30_000)
  await kinguPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.setSidebarOpen(false)
    state?.setRightSidebarOpen(false)
  })
  await expect
    .poll(
      () =>
        kinguPage.evaluate(() => {
          const state = window.__store?.getState()
          const tabId = state?.activeTabId
          const manager = tabId ? window.__paneManagers?.get(tabId) : null
          return manager?.getActivePane?.()?.terminal.cols ?? 0
        }),
      { message: 'terminal did not expand after closing the sidebars' }
    )
    .toBeGreaterThan(120)
  const ptyId = await waitForActivePanePtyId(kinguPage, 30_000)
  await waitForPtyShellEcho(kinguPage, ptyId, 15_000)
  const printedPath = process.platform === 'win32' ? filePath.replaceAll('\\', '/') : filePath
  const command = nodeTerminalCommand(['-e', `console.log(${JSON.stringify(printedPath)})`])
  await sendToTerminal(kinguPage, ptyId, `${command}\r`)
  await expect
    .poll(() => getTerminalContent(kinguPage, LINK_SCAN_CHAR_LIMIT), { timeout: 15_000 })
    .toContain(printedPath)

  let probe: LinkProbe | null = null
  await expect
    .poll(
      async () => {
        probe = await locateLink(kinguPage, printedPath)
        return probe ? hoverLink(kinguPage, probe) : null
      },
      { timeout: 10_000, message: 'sibling file path did not become clickable' }
    )
    .toContain('package.json')
  if (!probe) {
    throw new Error('sibling file link disappeared before activation')
  }
  await clickLink(kinguPage, probe)
  const actionPopover = kinguPage.locator('[data-terminal-link-action-popover]')
  await expect(actionPopover).toBeVisible()
  await actionPopover.getByRole('button', { name: /Open file/i }).click()

  const editorHeader = kinguPage.locator('.editor-header-path').first()
  await expect(editorHeader).toContainText('package.json', { timeout: 20_000 })
  await expect
    .poll(
      async () => {
        const rendered = await kinguPage.evaluate(() => ({
          filePath: window.__monacoEditorE2E?.filePath ?? '',
          activeWorktreeId: window.__store?.getState()?.activeWorktreeId ?? null
        }))
        return {
          filePath: canonicalFileIdentity(rendered.filePath),
          activeWorktreeId: rendered.activeWorktreeId
        }
      },
      { timeout: 20_000, message: 'sibling workspace never rendered the linked file' }
    )
    .toEqual({ filePath: canonicalFileIdentity(filePath), activeWorktreeId: sibling.id })
  await expect(kinguPage.getByText('Loading...', { exact: true })).toHaveCount(0)
})
