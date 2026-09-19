import { ipcRenderer } from 'electron'
import type { IdeSessionState } from '../../shared/ide-types'
import type { IdeApi } from './ide-api'

export const ideApi: IdeApi = {
  open: (folder: string): Promise<IdeSessionState> => ipcRenderer.invoke('ide:open', { folder }),
  close: (): Promise<void> => ipcRenderer.invoke('ide:close'),
  release: (): Promise<void> => ipcRenderer.invoke('ide:release')
}
