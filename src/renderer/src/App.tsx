import { useEffect, useState } from 'react'
import type { MenuAction } from '../../shared/types'
import { LayoutView } from './layout/LayoutView'
import { RecentsPanel } from './layout/RecentsPanel'
import { TopBar } from './layout/TopBar'
import { useDataStore } from './state/dataStore'
import { applyTheme, resolveTargetNodeId, useAppStore } from './state/store'
import { primaryModifier } from './lib/platform'

/** How long the layout must sit still before we stash it in userData. */
const SESSION_DEBOUNCE_MS = 700

export function App(): JSX.Element {
  const doc = useAppStore((state) => state.doc)
  const filePath = useAppStore((state) => state.filePath)
  const dirty = useAppStore((state) => state.dirty)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const maximizedNodeId = useAppStore((state) => state.maximizedNodeId)
  const theme = useAppStore((state) => state.theme)

  const [aboutOpen, setAboutOpen] = useState(false)
  const [restored, setRestored] = useState(false)

  useEffect(() => applyTheme(theme), [theme])

  /* Reference data changes in the main process — importing a pack, or a toggle. */
  useEffect(() => window.dmscreen.onDataChanged(useDataStore.getState().apply), [])

  /* Restore the previous session, then start tracking recents. */
  useEffect(() => {
    void (async () => {
      const [snapshot] = await Promise.all([
        window.dmscreen.readSession(),
        useAppStore.getState().refreshRecents()
      ])
      if (snapshot?.doc) {
        useAppStore.getState().loadDoc(snapshot.doc, snapshot.filePath, snapshot.dirty)
      }
      setRestored(true)
    })()
  }, [])

  /* Stash the working state so a crash or an accidental quit costs nothing. */
  useEffect(() => {
    if (!restored) return
    const timer = window.setTimeout(() => {
      void window.dmscreen.writeSession({ doc, filePath, dirty })
    }, SESSION_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [doc, filePath, dirty, restored])

  /* Keep the window title and the close-confirmation in sync. */
  useEffect(() => {
    void window.dmscreen.setDirty(dirty, doc.name)
  }, [dirty, doc.name])

  /* Menu commands run the same store actions the in-app buttons do. */
  useEffect(() => {
    return window.dmscreen.onMenuAction((action: MenuAction, payload?: string) => {
      const store = useAppStore.getState()
      const target = resolveTargetNodeId()

      switch (action) {
        case 'layout:new':
          store.newLayout()
          break
        case 'layout:open':
          void store.openLayout()
          break
        case 'layout:openRecent':
          if (payload) void store.openLayout(payload)
          break
        case 'recents:clear':
          void store.clearRecents()
          break
        case 'layout:save':
          // Main may be waiting on the outcome before letting the window close.
          void store.save().then((saved) => window.dmscreen.notifySaveComplete(saved))
          break
        case 'layout:saveAs':
          void store.saveAs()
          break
        case 'layout:rename':
          document.querySelector<HTMLButtonElement>('.layout-name')?.click()
          break
        case 'layout:toggleLock':
          store.toggleLock()
          break
        case 'panel:splitRight':
          if (target) store.splitPanel(target, 'row')
          break
        case 'panel:splitDown':
          if (target) store.splitPanel(target, 'column')
          break
        case 'panel:close':
          if (target) store.closePanel(target)
          break
        case 'panel:maximize':
          if (target) store.toggleMaximize(target)
          break
        case 'panel:restore':
          store.maximize(null)
          break
        case 'app:about':
          setAboutOpen(true)
          break
      }
    })
  }, [])

  /* Escape leaves panel fullscreen. Owned here rather than by a menu
     accelerator, which would swallow Escape inside text fields. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (aboutOpen) {
        setAboutOpen(false)
        return
      }
      if (useAppStore.getState().maximizedNodeId) {
        useAppStore.getState().maximize(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [aboutOpen])

  return (
    <div className={`app ${maximizedNodeId ? 'has-maximized' : ''}`}>
      <TopBar />

      <div className="workspace">
        <main className="canvas">
          <LayoutView node={doc.root} />
        </main>
        {sidebarOpen && <RecentsPanel />}
      </div>

      {maximizedNodeId && (
        <button className="restore-hint" onClick={() => useAppStore.getState().maximize(null)}>
          Esc to return to the full screen
        </button>
      )}

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [info, setInfo] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    void window.dmscreen
      .appInfo()
      .then((result) => setInfo(result as unknown as Record<string, string>))
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h2>Digital DM Screen</h2>
        <p className="note">
          Split the screen however you like, drop a module into each pane, and save the whole
          arrangement — settings and contents included — as a layout file.
        </p>

        <h4 className="section-title">Shortcuts</h4>
        <dl className="deflist">
          <div className="defrow">
            <dt>{primaryModifier}+\ / {primaryModifier}+Shift+\</dt>
            <dd>Split the active panel right / down</dd>
          </div>
          <div className="defrow">
            <dt>{primaryModifier}+Enter</dt>
            <dd>Fullscreen the active panel — Esc returns</dd>
          </div>
          <div className="defrow">
            <dt>{primaryModifier}+W</dt>
            <dd>Close the active panel</dd>
          </div>
          <div className="defrow">
            <dt>{primaryModifier}+S / {primaryModifier}+O / {primaryModifier}+N</dt>
            <dd>Save, open, new layout</dd>
          </div>
          <div className="defrow">
            <dt>F2</dt>
            <dd>Rename the layout</dd>
          </div>
          <div className="defrow">
            <dt>{primaryModifier}+L</dt>
            <dd>Lock or unlock the layout</dd>
          </div>
          <div className="defrow">
            <dt>Double-click a splitter</dt>
            <dd>Even out that row or column</dd>
          </div>
        </dl>

        {info && (
          <p className="note mono">
            v{info.version} · Electron {info.electron} · {info.platform}
            <br />
            {info.userData}
          </p>
        )}

        {/*
          CC BY 4.0 requires the attribution wherever the material is used, so it
          belongs here and not only in LICENSE.md. Plain text, not links:
          setWindowOpenHandler only intercepts window opens, so an anchor would
          navigate the app window itself with no way back.
        */}
        <p className="note">
          This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by
          Wizards of the Coast LLC and available at
          https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed
          under the Creative Commons Attribution 4.0 International License available at
          https://creativecommons.org/licenses/by/4.0/legalcode.
        </p>

        <button className="btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
