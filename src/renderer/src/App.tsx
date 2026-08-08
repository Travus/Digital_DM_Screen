import { useCallback, useEffect, useState } from 'react'
import { acceleratorFromChord, formatBinding } from '../../shared/accelerator'
import type { ActionId } from '../../shared/actions'
import { findParent } from '../../shared/layout'
import type { MenuAction } from '../../shared/types'
import { LayoutView } from './layout/LayoutView'
import { RecentsPanel } from './layout/RecentsPanel'
import { TopBar } from './layout/TopBar'
import { advanceChord, CHORD_TIMEOUT_MS } from './lib/chords'
import { useDataStore } from './state/dataStore'
import { useKeymapStore } from './state/keymapStore'
import { applyTheme, resolveTargetNodeId, useAppStore } from './state/store'
import { ActionPalette } from './components/ActionPalette'
import { ShortcutsDialog, ShortcutSummary } from './components/ShortcutsDialog'

/** How long the layout must sit still before we stash it in userData. */
const SESSION_DEBOUNCE_MS = 700

/**
 * Everything `runAction` can be asked to do, from either of its two callers.
 *
 * The two vocabularies overlap without matching: the menu can send
 * `layout:openRecent` and `recents:clear`, which are not bindable and so are not
 * in the catalogue, while the catalogue has `data:importPack`, which the menu
 * runs in main and never dispatches here.
 */
type RunnableAction = ActionId | MenuAction

export function App(): JSX.Element {
  const doc = useAppStore((state) => state.doc)
  const filePath = useAppStore((state) => state.filePath)
  const dirty = useAppStore((state) => state.dirty)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const maximizedNodeId = useAppStore((state) => state.maximizedNodeId)
  const theme = useAppStore((state) => state.theme)

  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [restored, setRestored] = useState(false)
  /** First half of a two-stroke sequence, while the app waits for the second. */
  const [pendingChord, setPendingChord] = useState<string | null>(null)

  const keymap = useKeymapStore((state) => state.keymap)

  useEffect(() => applyTheme(theme), [theme])

  /* Reference data changes in the main process — importing a pack, or a toggle. */
  useEffect(() => window.dmscreen.onDataChanged(useDataStore.getState().apply), [])

  /* Keybindings likewise: main owns them because main owns the menu. */
  useEffect(() => window.dmscreen.onKeymapChanged(useKeymapStore.getState().apply), [])

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

  /* Menu commands run the same store actions the in-app buttons do.
     Lifted out of the subscription so the chord dispatcher below can reach the
     same code path — a sequence must do exactly what its menu item does. Every
     setter it closes over is a stable `useState` one, so `[]` is honest. */
  const runAction = useCallback((action: RunnableAction, payload?: string): void => {
    const store = useAppStore.getState()
    const target = resolveTargetNodeId()
    // The split a command like Flip or Even Out acts on is the one *containing*
    // the target panel, which is what the ⋯ menu offers too.
    const surroundingSplit = target ? (findParent(store.doc.root, target)?.id ?? null) : null

    switch (action) {
      case 'layout:new':
        void store.newLayout()
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
        //
        // Flush the session before answering, rather than leaving it to the
        // debounced write below. On "Save and quit" the app exits within
        // milliseconds, so that timer never fires and session.json keeps the
        // pre-save snapshot — including `dirty: true`. The layout file was
        // always written correctly; the next launch just restored a stale flag
        // and asked to save again.
        void store.save().then(async (saved) => {
          if (saved) {
            const { doc: savedDoc, filePath: savedPath, dirty: savedDirty } = useAppStore.getState()
            await window.dmscreen.writeSession({
              doc: savedDoc,
              filePath: savedPath,
              dirty: savedDirty
            })
          }
          window.dmscreen.notifySaveComplete(saved)
        })
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
      case 'panel:rename':
        if (target) store.setRenamingNode(target)
        break
      case 'panel:changeModule':
        if (target) store.setPickingNode(target)
        break
      case 'split:flip':
        if (surroundingSplit) store.flipSplit(surroundingSplit)
        break
      case 'split:equalise':
        if (surroundingSplit) store.equalise(surroundingSplit)
        break
      case 'view:toggleTheme':
        store.setTheme(store.theme === 'dark' ? 'light' : 'dark')
        break
      case 'view:toggleSidebar':
        store.toggleSidebar()
        break
      case 'data:reloadPacks':
        void window.dmscreen.reloadDataPacks()
        break
      case 'app:about':
        setAboutOpen(true)
        break
      case 'app:shortcuts':
        setShortcutsOpen(true)
        break
      // Toggles rather than opens: the palette is reached by a key, and pressing
      // that key again is how anyone expects to put it away.
      case 'app:palette':
        setPaletteOpen((open) => !open)
        break
      // Goes through app.quit() in main so it takes the same route as the window
      // close button — including the unsaved-changes prompt.
      case 'app:quit':
        void window.dmscreen.quitApp()
        break
      // Handled in main, where the packs are read — but a sequence bound to it
      // arrives here, so the renderer needs a way to ask for it.
      case 'data:importPack':
        void window.dmscreen.importDataPack()
        break
    }
  }, [])

  useEffect(() => window.dmscreen.onMenuAction(runAction), [runAction])

  /* Two-stroke sequences. Single-stroke bindings never reach this: they are menu
     accelerators, which Electron fires before the renderer sees the key. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Escape is handled below, where cancelling a half-typed sequence is one
      // rung of the same priority chain as leaving fullscreen.
      if (event.key === 'Escape') return

      const stroke = acceleratorFromChord(event, window.dmscreen.platform)
      if (!stroke) return

      const outcome = advanceChord(pendingChord, stroke, keymap)
      if (outcome.type === 'ignore') return

      // Everything else is ours: swallow it. A stroke that completes nothing is
      // still swallowed, because half of `Ctrl+K 3` arriving as a literal "3" in
      // whatever field had focus is worse than the sequence quietly failing.
      event.preventDefault()

      if (outcome.type === 'pending') {
        setPendingChord(outcome.prefix)
        return
      }
      setPendingChord(null)
      if (outcome.type === 'fire') runAction(outcome.action)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pendingChord, keymap, runAction])

  /* A half-finished sequence gives up on its own, so a fumbled prefix cannot sit
     there swallowing whatever the user types next. */
  useEffect(() => {
    if (!pendingChord) return
    const timer = window.setTimeout(() => setPendingChord(null), CHORD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [pendingChord])

  /* Escape leaves panel fullscreen. Owned here rather than by a menu
     accelerator, which would swallow Escape inside text fields. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Abandoning a half-typed sequence outranks everything else: the user is
      // most likely correcting a fumbled prefix, not asking to leave fullscreen.
      if (pendingChord) {
        setPendingChord(null)
        return
      }
      // Above the dialogs because it is the only one of them that can be open
      // *over* another surface the user was mid-way through.
      if (paletteOpen) {
        setPaletteOpen(false)
        return
      }
      // The shortcuts editor takes Escape first while it is recording, on the
      // capture phase, so cancelling a capture never reaches this.
      if (shortcutsOpen) {
        setShortcutsOpen(false)
        return
      }
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
  }, [aboutOpen, shortcutsOpen, paletteOpen, pendingChord])

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

      {/* Says out loud that the app is holding a prefix and will swallow the next
          key. Without it a fumbled Ctrl+K looks exactly like a dropped keystroke. */}
      {pendingChord && (
        <div className="chord-pending" role="status">
          <kbd>{formatBinding(pendingChord, window.dmscreen.platform)}</kbd>
          <span>waiting for the second key — Esc to cancel</span>
        </div>
      )}

      {paletteOpen && <ActionPalette onRun={runAction} onClose={() => setPaletteOpen(false)} />}

      {aboutOpen && (
        <AboutDialog
          onClose={() => setAboutOpen(false)}
          onEditShortcuts={() => {
            setAboutOpen(false)
            setShortcutsOpen(true)
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}

function AboutDialog({
  onClose,
  onEditShortcuts
}: {
  onClose: () => void
  onEditShortcuts: () => void
}): JSX.Element {
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

        {/* Generated from the catalogue and the live keymap — this used to be a
            hand-kept list of literals, which is exactly what stops being safe
            once the bindings can change under it. */}
        <h4 className="section-title">Shortcuts</h4>
        <ShortcutSummary />
        <button className="btn" onClick={onEditShortcuts}>
          Change shortcuts…
        </button>

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
