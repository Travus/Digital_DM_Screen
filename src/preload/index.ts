import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  DataSnapshot,
  DocumentSnapshot,
  DocumentStatus,
  ImageRef,
  LayoutDoc,
  MenuAction,
  RecentEntry
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

  /**
   * The document as main holds it, read synchronously at preload so the store is
   * built around it and the first frame is already the restored screen.
   */
  initialDocument: ipcRenderer.sendSync('document:snapshot') as DocumentSnapshot,

  /**
   * An edit, sent to the copy that gets saved.
   *
   * The renderer stays authoritative for what the document contains — the tree
   * operations and the module state both live there — so this hands over the
   * result rather than a description of the change.
   */
  publishDocument: (doc: LayoutDoc): Promise<void> => ipcRenderer.invoke('document:publish', doc),

  /** Subscribe to the document being replaced. Returns an unsubscribe function. */
  onDocumentChanged: (handler: (snapshot: DocumentSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: DocumentSnapshot): void => handler(snapshot)
    ipcRenderer.on('document:changed', listener)
    return () => {
      ipcRenderer.off('document:changed', listener)
    }
  },

  /** Subscribe to the file path and unsaved flag moving without the document. */
  onDocumentStatus: (handler: (status: DocumentStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: DocumentStatus): void => handler(status)
    ipcRenderer.on('document:status', listener)
    return () => {
      ipcRenderer.off('document:status', listener)
    }
  },

  /**
   * The four file commands, which run entirely in main now that the document
   * lives there — including the unsaved-changes prompt New and Open ask first.
   * Save reports whether it happened, since a cancelled dialog is a "no".
   */
  newLayout: (): Promise<void> => ipcRenderer.invoke('layout:new'),
  /** Opens a layout. With no path, shows the system file picker. */
  openLayout: (path?: string): Promise<void> => ipcRenderer.invoke('layout:open', path),
  saveLayout: (): Promise<boolean> => ipcRenderer.invoke('layout:save'),
  saveLayoutAs: (): Promise<boolean> => ipcRenderer.invoke('layout:saveAs'),

  /** Shows the image picker and puts the result on main's guest list. */
  pickImage: (): Promise<ImageRef | null> => ipcRenderer.invoke('image:pick'),

  /**
   * Same list, for a path that came out of a saved layout or off a drop. The
   * `exists` flag comes back from main because only main can look.
   */
  resolveImage: (path: string): Promise<ImageRef> => ipcRenderer.invoke('image:resolve', path),

  /**
   * The path of a dropped file. Electron 32 removed `File.path`, and a
   * sandboxed renderer has no other way to learn one — `webUtils` is reachable
   * from the preload, so the bridge is the only route left.
   */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),

  listRecents: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:list'),
  removeRecent: (path: string): Promise<RecentEntry[]> =>
    ipcRenderer.invoke('recents:remove', path),
  clearRecents: (): Promise<RecentEntry[]> => ipcRenderer.invoke('recents:clear'),

  toggleWindowFullScreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggleFullScreen'),
  /** Quit, for the action palette — the menu's Quit item is a native role. */
  quitApp: (): Promise<void> => ipcRenderer.invoke('window:quit'),
  appInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),

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
  reloadDataPacks: (): Promise<void> => ipcRenderer.invoke('data:reloadPacks'),

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
