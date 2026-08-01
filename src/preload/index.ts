import { contextBridge, ipcRenderer } from 'electron'
import type {
  LayoutDoc,
  MenuAction,
  OpenResult,
  RecentEntry,
  SessionSnapshot
} from '../shared/types'

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
}

const api = {
  /** Opens a layout. With no path, shows the system file picker. */
  openLayout: (path?: string): Promise<OpenResult | null> => ipcRenderer.invoke('layout:open', path),
  saveLayout: (filePath: string, doc: LayoutDoc): Promise<string | null> =>
    ipcRenderer.invoke('layout:save', filePath, doc),
  saveLayoutAs: (doc: LayoutDoc): Promise<string | null> => ipcRenderer.invoke('layout:saveAs', doc),

  listRecents: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:list'),
  removeRecent: (path: string): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:remove', path),
  clearRecents: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:clear'),

  readSession: (): Promise<SessionSnapshot | null> => ipcRenderer.invoke('session:read'),
  writeSession: (snapshot: SessionSnapshot): Promise<void> =>
    ipcRenderer.invoke('session:write', snapshot),

  setDirty: (dirty: boolean, name: string): Promise<void> =>
    ipcRenderer.invoke('window:setDirty', dirty, name),
  toggleWindowFullScreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggleFullScreen'),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

  /**
   * Reports the outcome of a save that may have been triggered by the
   * close-confirmation dialog. `saved: false` (the file dialog was cancelled,
   * or the write failed) leaves the window open.
   */
  notifySaveComplete: (saved: boolean): void => {
    ipcRenderer.send('window:saveComplete', saved)
  },

  /** Subscribe to menu commands. Returns an unsubscribe function. */
  onMenuAction: (handler: (action: MenuAction, payload?: string) => void): (() => void) => {
    const listener = (_event: unknown, action: MenuAction, payload?: string): void =>
      handler(action, payload)
    ipcRenderer.on('menu:action', listener)
    return () => {
      ipcRenderer.off('menu:action', listener)
    }
  }
}

export type DmScreenApi = typeof api

contextBridge.exposeInMainWorld('dmscreen', api)
