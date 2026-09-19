import { readFileSync } from 'node:fs'
import { test, expect } from './helpers/kingu-app'
import {
  cleanupMarkdownFixture,
  closeActiveEditorTab,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import {
  expectEditableNestedToggles,
  expectFileKeepsNesting,
  expectPassthroughFallback,
  expectSentinelInsideNestedToggle,
  NESTED_TOGGLE_FIXTURE_DIRECTORY,
  NESTED_TOGGLE_MARKDOWN,
  placeCaretInNestedToggleBody,
  UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
} from './helpers/markdown-nested-toggle'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.describe('Markdown nested toggle regression', () => {
  test.beforeEach(async ({ kinguPage }) => {
    await waitForSessionReady(kinguPage)
    await waitForActiveWorktree(kinguPage)
  })

  test('a nested toggle on disk reopens as editable toggles', async ({ kinguPage }, testInfo) => {
    const context = await getActiveWorktreeContext(kinguPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-reopen',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(kinguPage, context, filePath)
      await waitForRichMarkdownEditor(kinguPage)

      await expectEditableNestedToggles(kinguPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('editing a nested toggle survives save and reopen', async ({ kinguPage }, testInfo) => {
    const context = await getActiveWorktreeContext(kinguPage)
    const sentinel = `editedInsideNestedToggle${Date.now()}`
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-edit',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(kinguPage, context, filePath)
      await waitForRichMarkdownEditor(kinguPage)
      await expectEditableNestedToggles(kinguPage)

      await placeCaretInNestedToggleBody(kinguPage)
      await kinguPage.keyboard.type(` ${sentinel}`)
      await expectSentinelInsideNestedToggle(kinguPage, sentinel)

      // Save through the real shortcut and assert the bytes that landed on disk.
      await kinguPage.keyboard.press('ControlOrMeta+S')
      const savedPath = filePath
      await expect
        .poll(() => readFileSync(savedPath, 'utf8'), { timeout: 10_000 })
        .toContain(sentinel)
      expectFileKeepsNesting(readFileSync(savedPath, 'utf8'), sentinel)

      // The reported bug only appeared on reopen, so close the tab and parse
      // the saved file again from scratch.
      await closeActiveEditorTab(kinguPage, savedPath)
      await openMarkdownFixture(kinguPage, context, savedPath)
      await waitForRichMarkdownEditor(kinguPage)
      await expectEditableNestedToggles(kinguPage)
      await expectSentinelInsideNestedToggle(kinguPage, sentinel)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a nested toggle that cannot be represented stays raw passthrough', async ({
    kinguPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(kinguPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-unsupported',
        testInfo.workerIndex,
        UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(kinguPage, context, filePath)
      await waitForRichMarkdownEditor(kinguPage)

      await expectPassthroughFallback(kinguPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
