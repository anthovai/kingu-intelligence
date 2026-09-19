/**
 * Partition for the IDE guest webview. Shared so the renderer names the same
 * one the main process admits in `will-attach-webview`.
 */
export const IDE_PARTITION = 'persist:kingu-ide'
