import type { JSHandle, Page } from '@playwright/test'
import { expect, test } from './helpers/kingu-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { startHiddenRendererFrameCapture } from './helpers/hidden-renderer-frame-capture'

type CardFrame = {
  title: string
  left: number
  count: number
  sliding: boolean
  at: number
  states: string[]
}
type CardRecording = { stop: () => CardFrame[] }

async function startCardRecording(page: Page): Promise<JSHandle<CardRecording>> {
  return page.evaluateHandle(() => {
    const frames: CardFrame[] = []
    const started = performance.now()
    let nextFrame = 0
    const record = (): void => {
      const cards = document.querySelectorAll('[data-tab-hover-card]')
      const element = cards[0]
      frames.push({
        at: performance.now() - started,
        states: Array.from(cards, (card) => card.getAttribute('data-state') ?? ''),
        title: element?.querySelector('[data-tab-hover-card-title]')?.textContent?.trim() ?? '',
        left: element?.getBoundingClientRect().left ?? -1,
        count: cards.length,
        sliding:
          element
            ?.getAnimations()
            .some(
              (animation) =>
                animation.effect instanceof KeyframeEffect &&
                animation.effect.getKeyframes().some((frame) => frame.translate !== undefined)
            ) ?? false
      })
      if (performance.now() - started < 10_000) {
        nextFrame = requestAnimationFrame(record)
      }
    }
    record()
    return {
      stop: () => {
        cancelAnimationFrame(nextFrame)
        return frames
      }
    }
  })
}

async function stopCardRecording(recording: JSHandle<CardRecording>): Promise<CardFrame[]> {
  try {
    return await recording.evaluate((recording) => recording.stop())
  } finally {
    await recording.dispose()
  }
}

test('whole-tab hover cards slide immediately between neighboring tabs', async ({
  electronApp,
  kinguPage
}) => {
  await waitForSessionReady(kinguPage)
  await waitForActiveWorktree(kinguPage)
  await ensureTerminalVisible(kinguPage)
  await kinguPage.evaluate(() => {
    const s = window.__store?.getState()
    const worktreeId = s?.activeWorktreeId
    if (!s || !worktreeId) {
      throw new Error('Missing workspace')
    }
    const first = s.tabsByWorktree[worktreeId]?.[0]
    if (!first) {
      throw new Error('Missing terminal tab')
    }
    s.setTabCustomTitle(first.id, 'Build and test the hover cards')
    const second = s.createTab(worktreeId)
    s.setTabCustomTitle(second.id, 'Review changes')
  })
  const browserWindow = await electronApp.browserWindow(kinguPage)
  await browserWindow.evaluate((window) => window.webContents.setBackgroundThrottling(false))
  await browserWindow.dispose()
  const stopCapture = await startHiddenRendererFrameCapture(kinguPage)
  try {
    const first = kinguPage.locator('[data-testid="sortable-tab"]').first()
    const second = kinguPage.locator('[data-testid="sortable-tab"]').nth(1)
    const firstBox = await first.boundingBox()
    const secondBox = await second.boundingBox()
    if (!firstBox || !secondBox) {
      throw new Error('Missing tab bounds')
    }
    const card = kinguPage.locator('[data-tab-hover-card]')
    const cardTitle = card.locator('[data-tab-hover-card-title]')

    // The left padding and icon used to sit outside the terminal title's trigger.
    await kinguPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
    await kinguPage.waitForTimeout(200)
    await expect(card).toHaveCount(0)
    await expect(cardTitle).toHaveText('Build and test the hover cards')
    const program = card.locator('[data-tab-hover-card-program]')
    await expect(program.locator('[data-shell-icon]')).toHaveCount(1)
    await expect(program).toHaveText('Terminal')
    const titleBox = await cardTitle.boundingBox()
    const programBox = await program.boundingBox()
    expect(programBox?.y).toBeGreaterThan((titleBox?.y ?? 0) + (titleBox?.height ?? 0))
    await kinguPage.waitForTimeout(200)

    const recording = await startCardRecording(kinguPage)
    await kinguPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
    await expect(cardTitle).toHaveText('Review changes', { timeout: 150 })
    await kinguPage.waitForTimeout(200)
    const frames = await stopCardRecording(recording)
    const firstTargetFrame = frames.findIndex((frame) => frame.title === 'Review changes')
    expect(firstTargetFrame, JSON.stringify(frames)).toBeGreaterThan(0)
    expect(
      frames
        .slice(0, firstTargetFrame)
        .every((frame) => frame.title === 'Build and test the hover cards')
    ).toBe(true)
    expect(frames.slice(firstTargetFrame).every((frame) => frame.title === 'Review changes')).toBe(
      true
    )
    expect(frames.some((frame) => frame.sliding)).toBe(true)
    expect(frames[firstTargetFrame]?.left).toBeLessThan(secondBox.x - 10)
    await expect(cardTitle).toHaveText('Review changes')
    await kinguPage.waitForTimeout(500)

    await kinguPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
    await expect(cardTitle).toHaveText('Build and test the hover cards', { timeout: 150 })
    await kinguPage.waitForTimeout(600)
    await kinguPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
    await expect(cardTitle).toHaveText('Review changes', { timeout: 150 })

    const reversalRecording = await startCardRecording(kinguPage)
    for (let index = 0; index < 12; index += 1) {
      const target = index % 2 === 0 ? firstBox : secondBox
      const title = index % 2 === 0 ? 'Build and test the hover cards' : 'Review changes'
      await kinguPage.mouse.move(target.x + 3, target.y + target.height / 2)
      await expect(cardTitle).toHaveText(title, { timeout: 150 })
      await kinguPage.waitForTimeout(30)
      await expect(card).toHaveCount(1)
    }
    const reversalFrames = await stopCardRecording(reversalRecording)
    expect(
      reversalFrames.every((frame) => frame.count === 1),
      JSON.stringify(reversalFrames)
    ).toBe(true)
    for (const title of ['Build and test the hover cards', 'Review changes']) {
      expect(reversalFrames.some((frame) => frame.title === title && frame.sliding)).toBe(true)
    }

    await first.locator('[data-tab-close-button]').hover()
    await kinguPage.waitForTimeout(100)
    await expect(cardTitle).toHaveText('Build and test the hover cards')
    await expect(kinguPage.locator('[data-tab-hover-card], [data-tab-close-tooltip]')).toHaveCount(
      1
    )
    await kinguPage.waitForTimeout(500)
    await expect(cardTitle).toHaveText('Build and test the hover cards')
    await expect(kinguPage.locator('[data-tab-hover-card], [data-tab-close-tooltip]')).toHaveCount(
      1
    )
    await expect(kinguPage.locator('[data-tab-close-tooltip]')).toBeVisible()
    await expect(card).toHaveCount(0)
    await kinguPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
    await expect(cardTitle).toHaveText('Review changes')

    await kinguPage.emulateMedia({ reducedMotion: 'reduce' })
    await kinguPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height / 2)
    await expect(cardTitle).toHaveText('Build and test the hover cards')
    expect(await card.evaluate((element) => element.getAnimations().length)).toBe(0)
    await first.locator('[data-tab-close-button]').focus()
    await expect(kinguPage.locator('[data-tab-close-tooltip]')).toBeVisible()
    await expect(card).toHaveCount(0)
    await first.focus()
    await expect(cardTitle).toHaveText('Build and test the hover cards')
    await expect(kinguPage.locator('[data-tab-close-tooltip]')).toHaveCount(0)
    await first.press('Escape')
    await expect(card).toHaveCount(0)

    await first.click({ position: { x: 3, y: firstBox.height / 2 } })
    await expect(card).toHaveCount(0)

    await kinguPage.mouse.move(firstBox.x + 3, firstBox.y + firstBox.height + 100)
    await kinguPage.waitForTimeout(400)
    await kinguPage.mouse.move(secondBox.x + 3, secondBox.y + secondBox.height / 2)
    await kinguPage.waitForTimeout(200)
    await expect(card).toHaveCount(0)
    await expect(cardTitle).toHaveText('Review changes')
    await kinguPage.waitForTimeout(500)
  } finally {
    await stopCapture()
  }
})
