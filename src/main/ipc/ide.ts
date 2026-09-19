import { ipcMain } from 'electron'
import type { IdeSessionRequest, IdeSessionState } from '../../shared/ide-types'
import { closeIdeSession, openIdeSession, releaseIdeSession } from '../ide/ide-session-service'

export const IDE_OPEN_CHANNEL = 'ide:open'
export const IDE_CLOSE_CHANNEL = 'ide:close'
export const IDE_RELEASE_CHANNEL = 'ide:release'

export function registerIdeHandlers(): void {
  ipcMain.handle(
    IDE_OPEN_CHANNEL,
    async (_event, request: IdeSessionRequest): Promise<IdeSessionState> => {
      const folder = typeof request?.folder === 'string' ? request.folder : ''
      if (!folder) {
        return { status: 'unavailable', reason: 'start-failed' }
      }
      return openIdeSession(folder)
    }
  )

  ipcMain.handle(IDE_CLOSE_CHANNEL, async (): Promise<void> => {
    await closeIdeSession()
  })

  ipcMain.handle(IDE_RELEASE_CHANNEL, (): void => {
    releaseIdeSession()
  })
}
