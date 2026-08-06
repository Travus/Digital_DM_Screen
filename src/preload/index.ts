import { contextBridge, ipcRenderer } from 'electron'
import type {
  DataSnapshot,
  LayoutDoc,
  MenuAction,
  OpenResult,
  RecentEntry,
  SessionSnapshot
} from '../shared/types'
import type { Keymap, ResolvedKeymap } from '../shared/actions'

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  userData: string
}

const api = {
  /** Available synchronously so rendered shortcut labels match the native menu. */
  platform: process.platform,

  /** Opens a layout. With no path, shows the system file picker. */
  openLayout: (path?: string): Promise<OpenResult | null> =>
    ipcRenderer.invoke('layout:open', path),
  saveLayout: (filePath: string, doc: LayoutDoc): Promise<string | null> =>
    ipcRenderer.invoke('layout:save', filePath, doc),
  saveLayoutAs: (doc: LayoutDoc): Promise<string | null> =>
    ipcRenderer.invoke('layout:saveAs', doc),

  listRecents: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:list'),
  removeRecent: (path: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke('recents:remove', path),
  clearRecents: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:clear'),

  readSession: (): Promise<SessionSnapshot | null> => ipcRenderer.invoke('session:read'),
  writeSession: (snapshot: SessionSnapshot): Promise<void> =>
    ipcRenderer.invoke('session:write', snapshot),

  setDirty: (dirty: boolean, name: string): Promise<void> =>
    ipcRenderer.invoke('window:setDirty', dirty, name),
  /** Prompts before New or Open throws away unsaved changes. */
  confirmDiscard: (name: string): Promise<'save' | 'discard' | 'cancel'> =>
    ipcRenderer.invoke('window:confirmDiscard', name),
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
  },

  /**
   * Reference data, read synchronously at preload so the renderer's data store
   * is populated before the first render. Main loads it before the window opens,
   * so this only reads an object already in memory.
   */
  initialData: ipcRenderer.sendSync('data:snapshot') as DataSnapshot,

  /** Subscribe to pack/toggle changes. Returns an unsubscribe function. */
  onDataChanged: (handler: (snapshot: DataSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: DataSnapshot): void => handler(snapshot)
    ipcRenderer.on('data:changed', listener)
    return () => {
      ipcRenderer.off('data:changed', listener)
    }
  },

  /**
   * Defaults with the user's overrides applied, read synchronously for the same
   * reason as `initialData` — shortcut labels are on screen in the first paint.
   */
  initialKeymap: ipcRenderer.sendSync('keymap:snapshot') as ResolvedKeymap,

  /** Just the user's changes, which is what the editor shows as "changed". */
  keymapOverrides: (): Promise<Keymap> => ipcRenderer.invoke('keymap:overrides'),

  /**
   * Import runs in main, where the packs are read and indexed, so the menu item
   * calls it directly. A two-stroke binding for it lands in the renderer though,
   * which needs this to reach the same code.
   */
  importDataPack: (): Promise<void> => ipcRenderer.invoke('data:importPack'),

  /** Persists overrides and rebuilds the menu. Resolves to the merged result. */
  setKeymap: (overrides: Keymap): Promise<ResolvedKeymap> =>
    ipcRenderer.invoke('keymap:set', overrides),
  resetKeymap: (): Promise<ResolvedKeymap> => ipcRenderer.invoke('keymap:reset'),

  /** Subscribe to keybinding changes. Returns an unsubscribe function. */
  onKeymapChanged: (handler: (keymap: ResolvedKeymap) => void): (() => void) => {
    const listener = (_event: unknown, keymap: ResolvedKeymap): void => handler(keymap)
    ipcRenderer.on('keymap:changed', listener)
    return () => {
      ipcRenderer.off('keymap:changed', listener)
    }
  }
}

export type DmScreenApi = typeof api

contextBridge.exposeInMainWorld('dmscreen', api)
