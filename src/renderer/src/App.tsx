import { useCallback, useEffect, useState } from 'react'
import { acceleratorFromChord, formatBinding } from '../../shared/accelerator'
import type { ActionId } from '../../shared/actions'
import { findParent, RESIZE_STEP } from '../../shared/layout'
import type { MenuAction } from '../../shared/types'
import { LayoutView } from './layout/LayoutView'
import { RecentsPanel } from './layout/RecentsPanel'
import { TopBar } from './layout/TopBar'
import { advanceChord, CHORD_TIMEOUT_MS } from './lib/chords'
import { useDataStore } from './state/dataStore'
import { useKeymapStore } from './state/keymapStore'
import { applyTheme, myRoot, resolveTargetNodeId, useAppStore } from './state/store'
import { ActionPalette } from './components/ActionPalette'
import { ShortcutsDialog, ShortcutSummary } from './components/ShortcutsDialog'

/** How long the fullscreen hint holds before it starts fading. */
const RESTORE_HINT_MS = 4000

/** Length of that fade — must match the transition on `.restore-hint`. */
const RESTORE_HINT_FADE_MS = 300

/**
 * Everything `runAction` can be asked to do, from either of its two callers.
 *
 * The two vocabularies overlap without matching: the menu can send
 * `layout:openRecent` and `recents:clear`, which are not bindable and so are not
 * in the catalogue, while the catalogue has `data:importPack`, which the menu
 * runs in main and never dispatches here.
 */
type RunnableAction = ActionId | MenuAction

/**
 * Only *bare* Escape is the dismiss key. A modified Escape is an ordinary
 * bindable chord, so both keydown listeners have to agree on the distinction —
 * the dismiss chain must ignore it, and the chord dispatcher must stop skipping
 * it, or a binding like `CmdOrCtrl+K CmdOrCtrl+Escape` validates and then never
 * fires.
 */
function isBareEscape(event: KeyboardEvent): boolean {
  return (
    event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
  )
}

export function App(): JSX.Element {
  const root = useAppStore(myRoot)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const maximizedNodeId = useAppStore((state) => state.maximizedNodeId)
  const theme = useAppStore((state) => state.theme)

  const [aboutOpen, setAboutOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [restored, setRestored] = useState(false)
  /** How far the fullscreen hint is through saying its piece and leaving. */
  const [restoreHint, setRestoreHint] = useState<'up' | 'fading' | 'gone'>('gone')
  /** First half of a two-stroke sequence, while the app waits for the second. */
  const [pendingChord, setPendingChord] = useState<string | null>(null)

  const keymap = useKeymapStore((state) => state.keymap)

  useEffect(() => applyTheme(theme), [theme])

  /* Reference data changes in the main process — importing a pack, or a toggle. */
  useEffect(() => window.dmscreen.onDataChanged(useDataStore.getState().apply), [])

  /* The theme, changed in another window — this one has no control for it if it
     is a secondary. */
  useEffect(
    () =>
      window.dmscreen.onThemeChanged((theme) =>
        useAppStore.getState().adoptTheme(theme === 'light' ? 'light' : 'dark')
      ),
    []
  )

  /* Keybindings likewise: main owns them because main owns the menu. */
  useEffect(() => window.dmscreen.onKeymapChanged(useKeymapStore.getState().apply), [])

  /* The document arrives at preload, so there is nothing to restore here — only
     the recents, which are a sidebar rather than the screen. */
  useEffect(() => {
    void useAppStore
      .getState()
      .refreshRecents()
      .then(() => setRestored(true))
  }, [])

  /* A different document: New or Open. Resets what this window was looking at,
     because what it was looking at is gone. */
  useEffect(() => window.dmscreen.onDocumentChanged(useAppStore.getState().adoptDocument), [])
  useEffect(() => window.dmscreen.onDocumentStatus(useAppStore.getState().adoptStatus), [])

  /* The same document, moved by another window. Arrives on every keystroke over
     there, so this one keeps its fullscreen and its selection. */
  useEffect(() => window.dmscreen.onPeerDocument(useAppStore.getState().adoptPeerDocument), [])

  /* A write another window aimed at a panel on this one — the initiative tracker
     pushing HP back to a party panel across the screen. Applied here because
     this window is the only one entitled to write these panels. */
  useEffect(
    () =>
      window.dmscreen.onPatchPanel((panelId, patch, kind) => {
        const store = useAppStore.getState()
        if (kind === 'state') store.updatePanelState(panelId, patch)
        else store.updatePanelSettings(panelId, patch)
      }),
    []
  )

  /* The app's ready line, published to the DOM.

     The smoke harness waits on this rather than on a fixed dwell, because a
     dwell can only be tuned for one machine: too short and a shot drives an app
     that has not settled, too long and every shot in the suite pays for the
     slowest. Set from an effect, so it cannot land before the commit it stands
     for — see `waitForReady` in `src/main/index.ts`. */
  useEffect(() => {
    if (restored) document.documentElement.dataset.ready = 'true'
  }, [restored])

  /* Menu commands run the same store actions the in-app buttons do.
     Lifted out of the subscription so the chord dispatcher below can reach the
     same code path — a sequence must do exactly what its menu item does. Every
     setter it closes over is a stable `useState` one, so `[]` is honest. */
  const runAction = useCallback((action: RunnableAction, payload?: string): void => {
    const store = useAppStore.getState()
    const target = resolveTargetNodeId()
    // The split a command like Flip or Even Out acts on is the one *containing*
    // the target panel, which is what the ⋯ menu offers too.
    const root = myRoot(store)
    const surroundingSplit = target && root ? (findParent(root, target)?.id ?? null) : null

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
        void store.save()
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
      case 'panel:swapLeft':
        if (target) store.swapWithNeighbour(target, 'left')
        break
      case 'panel:swapRight':
        if (target) store.swapWithNeighbour(target, 'right')
        break
      case 'panel:swapUp':
        if (target) store.swapWithNeighbour(target, 'up')
        break
      case 'panel:swapDown':
        if (target) store.swapWithNeighbour(target, 'down')
        break
      /* Which boundary moves is the store's business — the panel may be the last
         in its split, where growing means taking from the pane before it. What
         is said here is only the axis and which way. */
      case 'panel:wider':
        if (target) store.resizePanel(target, 'row', RESIZE_STEP)
        break
      case 'panel:narrower':
        if (target) store.resizePanel(target, 'row', -RESIZE_STEP)
        break
      case 'panel:taller':
        if (target) store.resizePanel(target, 'column', RESIZE_STEP)
        break
      case 'panel:shorter':
        if (target) store.resizePanel(target, 'column', -RESIZE_STEP)
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
      case 'window:new':
        void store.addWindow()
        break
      case 'window:close':
        // Refused for the primary in the store as well as in the catalogue —
        // closing that one is quitting, which has its own command.
        if (!store.isPrimary) void store.closeWindow(store.windowId)
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
      // Bare Escape is handled below, where cancelling a half-typed sequence is
      // one rung of the same priority chain as leaving fullscreen. A *modified*
      // Escape is a normal stroke and has to reach `advanceChord`, or a sequence
      // ending on one could be bound but never completed.
      if (isBareEscape(event)) return

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
      if (!isBareEscape(event)) return
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

  /* The hint says its piece and then gets out of the way. Parked at the bottom
     centre it sits on top of whatever the fullscreened module put there — the
     dice history today, and whatever a later module lands in the same strip —
     and a panel given the whole window is one the user means to look at.

     Two timers rather than one because it fades before it goes: an element at
     `opacity: 0` still takes the click meant for what is underneath it, so the
     fade only stops it being *seen* and the unmount is what stops it being in
     the way. Keyed on the id, so fullscreening a second panel says it again. */
  useEffect(() => {
    if (!maximizedNodeId) {
      setRestoreHint('gone')
      return
    }
    setRestoreHint('up')
    const fade = window.setTimeout(() => setRestoreHint('fading'), RESTORE_HINT_MS)
    const hide = window.setTimeout(
      () => setRestoreHint('gone'),
      RESTORE_HINT_MS + RESTORE_HINT_FADE_MS
    )
    return () => {
      window.clearTimeout(fade)
      window.clearTimeout(hide)
    }
  }, [maximizedNodeId])

  return (
    <div className={`app ${maximizedNodeId ? 'has-maximized' : ''}`}>
      <TopBar />

      <div className="workspace">
        <main className="canvas">{root && <LayoutView node={root} />}</main>
        {sidebarOpen && <RecentsPanel />}
      </div>

      {maximizedNodeId && restoreHint !== 'gone' && (
        <button
          className={`restore-hint ${restoreHint === 'fading' ? 'fading' : ''}`}
          onClick={() => useAppStore.getState().maximize(null)}
        >
          Esc to exit fullscreen
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
