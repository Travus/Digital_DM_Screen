import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PanelNode } from '../../../shared/types'
import { actionUnavailable, type ActionContext } from '../../../shared/actions'
import { EMPTY_MODULE_ID, findParent, neighbourSides } from '../../../shared/layout'
import { getModule } from '../modules/registry'
import { useAppStore } from '../state/store'
import { parenthesised, useShortcuts } from '../lib/shortcuts'
import { placeMenu, type Placement, type Size } from '../lib/menuPlacement'
import { ModulePicker } from './ModulePicker'

/**
 * `ModuleProps.setState` lets a module pass either a patch or a function
 * deriving one from the previous state. The host has erased that module's own
 * state type by this point, so it sees the callback as a plain bag-to-bag
 * function — narrowing `unknown` with `typeof === 'function'` only gets as far
 * as `Function`, which is not callable without this.
 */
type StatePatchFn = (previous: Record<string, unknown>) => Record<string, unknown>

/**
 * What a panel drag carries, and how a drop tells one apart from a file.
 *
 * A custom type rather than `text/plain`: the Image module accepts dropped files
 * on the same panels, a textarea would happily insert dropped text, and
 * `dataTransfer.types` is the one thing readable during `dragover` — so the
 * highlight and the drop can both ask the same question. The payload is the
 * source panel's *node* id, since that is what a swap is written in terms of.
 */
const PANEL_DRAG_TYPE = 'application/x-dmscreen-panel'

export function PanelFrame({ node }: { node: PanelNode }): JSX.Element {
  const panel = useAppStore((state) => state.doc.panels[node.panelId])
  const maximized = useAppStore((state) => state.maximizedNodeId === node.id)
  const active = useAppStore((state) => state.activeNodeId === node.id)

  const setActive = useAppStore((state) => state.setActive)
  const toggleMaximize = useAppStore((state) => state.toggleMaximize)
  const splitPanel = useAppStore((state) => state.splitPanel)
  const closePanel = useAppStore((state) => state.closePanel)
  const setPanelModule = useAppStore((state) => state.setPanelModule)
  const setPanelTitle = useAppStore((state) => state.setPanelTitle)
  const updatePanelState = useAppStore((state) => state.updatePanelState)
  const updatePanelSettings = useAppStore((state) => state.updatePanelSettings)

  // Selecting the id (not the node) keeps this a plain string compare, so the
  // panel doesn't re-render every time anything in the document changes.
  const parentSplitId = useAppStore((state) => findParent(state.doc.root, node.id)?.id ?? null)
  const flipSplit = useAppStore((state) => state.flipSplit)
  const equalise = useAppStore((state) => state.equalise)
  const swapWithNode = useAppStore((state) => state.swapWithNode)
  const locked = useAppStore((state) => state.doc.locked)
  const anyMaximized = useAppStore((state) => state.maximizedNodeId !== null)

  /* The tree itself, for the neighbour arithmetic below. Its identity only
     changes when the arrangement does, so typing in a panel does not re-measure
     anything — `doc` is replaced on every keystroke, `doc.root` is not. */
  const root = useAppStore((state) => state.doc.root)
  const neighbours = useMemo(() => neighbourSides(root, node.id), [root, node.id])

  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /* Whether this panel is the one being carried, and whether it is the one under
     the pointer. Local state: a drag in flight is a gesture, not a change to the
     layout, and nothing outside this panel has to know about either. */
  const [dragging, setDragging] = useState(false)
  const [dropping, setDropping] = useState(false)
  /* In the store rather than local state so a keyboard command can open them —
     a shortcut has no way into another component's `useState`. */
  const renaming = useAppStore((state) => state.renamingNodeId === node.id)
  const picking = useAppStore((state) => state.pickingNodeId === node.id)
  const setRenamingNode = useAppStore((state) => state.setRenamingNode)
  const setPickingNode = useAppStore((state) => state.setPickingNode)

  const setRenaming = (open: boolean): void => setRenamingNode(open ? node.id : null)
  const setPicking = (open: boolean): void => setPickingNode(open ? node.id : null)

  const shortcuts = useShortcuts()

  const module = panel ? getModule(panel.moduleId) : undefined
  const showPicker = picking || !module || panel?.moduleId === EMPTY_MODULE_ID

  /**
   * A module's defaults are built once per mounted module, never per render.
   * Some modules seed starter content with generated ids; regenerating those on
   * every render meant persisted state (say, "the selected table is tbl_x")
   * pointed at ids that no longer existed, so the first interaction with any
   * default-provided item silently did nothing.
   *
   * A ref rather than useMemo: React is free to discard a memo, and that would
   * quietly reintroduce the bug.
   */
  const defaultsRef = useRef<{
    moduleId: string
    state: Record<string, unknown>
    settings: Record<string, unknown>
  } | null>(null)

  if (module && defaultsRef.current?.moduleId !== module.id) {
    defaultsRef.current = {
      moduleId: module.id,
      // `AnyModule` is deliberately ModuleDefinition<any, any> — the registry is
      // heterogeneous — so these come back untyped. This is the boundary where
      // that stops: the host only ever treats them as bags of keys.
      state: module.defaultState() as Record<string, unknown>,
      settings: module.defaultSettings() as Record<string, unknown>
    }
  }
  const defaults = module ? defaultsRef.current : null

  /**
   * Persisted state is merged over those defaults on every read, so a module
   * can add new state fields without breaking layouts saved earlier.
   */
  const state = useMemo(() => ({ ...defaults?.state, ...panel?.state }), [defaults, panel?.state])
  const settings = useMemo(
    () => ({ ...defaults?.settings, ...panel?.settings }),
    [defaults, panel?.settings]
  )

  // Both setters re-read from the store rather than closing over `state`, so
  // rapid successive updates can't clobber each other.
  const setState = useCallback(
    (patch: unknown) => {
      const base = defaultsRef.current
      if (!base) return
      const current = {
        ...base.state,
        ...useAppStore.getState().doc.panels[node.panelId]?.state
      }
      const next = typeof patch === 'function' ? (patch as StatePatchFn)(current) : patch
      updatePanelState(node.panelId, next as Record<string, unknown>)
    },
    [node.panelId, updatePanelState]
  )

  const setSettings = useCallback(
    (patch: unknown) => {
      const base = defaultsRef.current
      if (!base) return
      const current = {
        ...base.settings,
        ...useAppStore.getState().doc.panels[node.panelId]?.settings
      }
      const next = typeof patch === 'function' ? (patch as StatePatchFn)(current) : patch
      updatePanelSettings(node.panelId, next as Record<string, unknown>)
    },
    [node.panelId, updatePanelSettings]
  )

  if (!panel) return <div className="panel" />

  const title = panel.title ?? module?.name ?? 'Choose a module'

  /**
   * The same struct the palette asks its questions of, answered for this panel:
   * a menu row on a panel is always acting on that panel, whichever one the
   * keyboard would have picked.
   *
   * The rows themselves are hand-ordered here, but *why* a row is off comes from
   * the catalogue. A lock check written in this file is how the menu and the
   * palette come to disagree about what a locked layout allows.
   */
  const context: ActionContext = {
    locked,
    hasPanel: true,
    maximized: anyMaximized,
    hasSplit: parentSplitId !== null,
    neighbours
  }

  // Read once: the title button, the ⋯ row and the row that resets the name are
  // three ways to the same command, and they have to be off together.
  const renameOff = actionUnavailable('panel:rename', context)

  /**
   * Drag a panel onto another to swap the two.
   *
   * HTML5 drag-and-drop rather than pointer events, because the module bodies
   * already take pointer drags of their own — panning an image, drawing a block
   * selection across table cells — and a gesture crossing into one of those has
   * to be a different kind of event, not the same kind arbitrated by hand.
   *
   * The header is the grip, minus the moment its rename field is open: a
   * draggable ancestor takes the pointer that would have selected text in it.
   */
  const canDrag = !locked && !anyMaximized && !renaming

  const acceptsDrag = (event: React.DragEvent): boolean =>
    !locked && !anyMaximized && event.dataTransfer.types.includes(PANEL_DRAG_TYPE)

  return (
    <section
      className={`panel ${maximized ? 'maximized' : ''} ${active ? 'active' : ''} ${
        dragging ? 'dragging' : ''
      } ${dropping ? 'drop-target' : ''}`}
      onPointerDownCapture={() => setActive(node.id)}
      onDragOver={(event) => {
        if (!acceptsDrag(event)) return
        // Claims the drop from whatever is underneath: the Image module's own
        // zone accepts anything dropped on it, and Chromium's default for the
        // rest of the window is to navigate to what was dropped.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        if (!dragging) setDropping(true)
      }}
      onDragLeave={(event) => {
        // Crossing from the header into the body fires a leave on the way past;
        // only one landing outside the panel means the pointer has gone.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDropping(false)
      }}
      onDrop={(event) => {
        setDropping(false)
        if (!acceptsDrag(event)) return
        event.preventDefault()
        const from = event.dataTransfer.getData(PANEL_DRAG_TYPE)
        // Dropped on itself is a no-op the store recognises, so it needs no
        // check here.
        if (from) swapWithNode(from, node.id)
      }}
    >
      <header
        className="panel-head"
        draggable={canDrag}
        title={canDrag ? 'Drag onto another panel to swap them' : undefined}
        onDragStart={(event) => {
          event.dataTransfer.setData(PANEL_DRAG_TYPE, node.id)
          event.dataTransfer.effectAllowed = 'move'
          setDragging(true)
        }}
        onDragEnd={() => setDragging(false)}
      >
        <span className="panel-icon">{module?.icon ?? '▫'}</span>

        {renaming ? (
          <input
            className="panel-title-input"
            autoFocus
            defaultValue={panel.title ?? module?.name ?? ''}
            /* Selected on arrival, so typing replaces rather than appends —
               see the matching field in `TopBar` for why this hangs off focus
               rather than off a ref. */
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => {
              setPanelTitle(node.panelId, event.target.value)
              setRenaming(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button
            className="panel-title"
            /* Only the rename half is off — the click that opens the module
               picker is a change to the contents, which a lock does not touch. */
            title={
              renameOff ? `Cannot be renamed — ${renameOff}` : 'Double-click to rename this panel'
            }
            onDoubleClick={() => setRenaming(true)}
            onClick={() => setPicking(!picking)}
          >
            {title}
          </button>
        )}

        <span className="spacer" />

        <div className="panel-actions">
          {module?.Settings && (
            <button
              className={`icon-btn ${settingsOpen ? 'on' : ''}`}
              title="Panel settings"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              ⚙
            </button>
          )}
          {/* Keep the "Fullscreen" opening — smoke.mjs selects on it. */}
          <button
            className="icon-btn"
            title={
              maximized
                ? `Return to normal view${parenthesised(shortcuts['panel:restore'])}`
                : `Fullscreen this panel${parenthesised(shortcuts['panel:maximize'])}`
            }
            onClick={() => toggleMaximize(node.id)}
          >
            {maximized ? '⤡' : '⤢'}
          </button>
          <PanelMenu
            open={menuOpen}
            onOpenChange={setMenuOpen}
            items={[
              { id: 'change-module', label: 'Change module…', onSelect: () => setPicking(true) },
              {
                id: 'rename',
                label: 'Rename panel…',
                disabled: renameOff,
                onSelect: () => setRenaming(true)
              },
              ...(panel.title
                ? [
                    {
                      id: 'reset-name',
                      label: 'Reset panel name',
                      // Resetting *is* renaming — back to the module's own name
                      // — so it answers to that command's guard rather than to a
                      // second one written out here.
                      disabled: renameOff,
                      onSelect: () => setPanelTitle(node.panelId, undefined)
                    }
                  ]
                : []),
              /* The structural rows used to disappear — while the layout was
                 locked, and Flip and Even Out whenever the panel stood alone.
                 They stay and grey out instead, keeping every row at the
                 position it is reached at, and each carrying the reason it is
                 off. A menu whose length changes with the state is a menu you
                 have to read every time. */
              { separator: true },
              {
                id: 'split-right',
                label: 'Split right',
                shortcut: shortcuts['panel:splitRight'],
                disabled: actionUnavailable('panel:splitRight', context),
                onSelect: () => splitPanel(node.id, 'row')
              },
              {
                id: 'split-down',
                label: 'Split down',
                shortcut: shortcuts['panel:splitDown'],
                disabled: actionUnavailable('panel:splitDown', context),
                onSelect: () => splitPanel(node.id, 'column')
              },
              {
                id: 'flip',
                label: 'Flip surrounding split',
                disabled: actionUnavailable('split:flip', context),
                onSelect: () => {
                  if (parentSplitId) flipSplit(parentSplitId)
                }
              },
              {
                id: 'equalise',
                label: 'Even out surrounding split',
                disabled: actionUnavailable('split:equalise', context),
                onSelect: () => {
                  if (parentSplitId) equalise(parentSplitId)
                }
              },
              { separator: true },
              {
                id: 'close',
                label: 'Close panel',
                shortcut: shortcuts['panel:close'],
                danger: true,
                disabled: actionUnavailable('panel:close', context),
                onSelect: () => closePanel(node.id)
              }
            ]}
          />
        </div>
      </header>

      {settingsOpen && module?.Settings && (
        <div className="panel-settings">
          <div className="panel-settings-head">
            <h3>{module.name} settings</h3>
            <button
              className="icon-btn"
              title="Close settings"
              onClick={() => setSettingsOpen(false)}
            >
              ✕
            </button>
          </div>
          <module.Settings
            state={state}
            setState={setState}
            settings={settings}
            setSettings={setSettings}
            panelId={node.panelId}
            maximized={maximized}
          />
        </div>
      )}

      <div className="panel-body">
        {showPicker ? (
          <ModulePicker
            currentModuleId={panel.moduleId}
            onPick={(moduleId) => {
              if (moduleId !== panel.moduleId) setPanelModule(node.panelId, moduleId)
              setPicking(false)
              setSettingsOpen(false)
            }}
            onCancel={module ? () => setPicking(false) : undefined}
          />
        ) : (
          module && (
            <module.Component
              state={state}
              setState={setState}
              settings={settings}
              setSettings={setSettings}
              panelId={node.panelId}
              maximized={maximized}
            />
          )
        )}
      </div>
    </section>
  )
}

interface MenuItem {
  /**
   * A stable handle for the smoke harness, since nothing selects a row by its
   * label — the same argument as `data-module-id` on the picker cards. The
   * tooltip used to be handle enough, but two rows can now be off for the same
   * reason and it stopped telling them apart.
   */
  id?: string
  label?: string
  /** Shown faintly at the right of the row, the way a native menu does it. */
  shortcut?: string
  /**
   * Why the row cannot be used, from the catalogue, or null when it can.
   * Presence is the flag — there is no separate boolean to fall out of step
   * with it, for the same reason `ActionDef.unavailable` has none.
   *
   * A menu row has nowhere to put an explanation the way the palette does, so
   * this becomes the row's tooltip. That is also why the row is greyed at all:
   * without the reason it would be a dead row with no account of itself, which
   * is what dropping it avoided.
   */
  disabled?: string | null
  onSelect?: () => void
  danger?: boolean
  separator?: boolean
}

function PanelMenu({
  open,
  onOpenChange,
  items
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: MenuItem[]
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown)
  }, [open, onOpenChange])

  /**
   * The menu is `fixed`, so it has to be told where to go. Measured in a layout
   * effect, which runs before the browser paints: the pass rendered without a
   * placement is never seen.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    // The natural size is taken once, on that first placement-less pass. Taking
    // it again after a max-height has been applied would read the capped height
    // back, and the menu would latch to whichever side it first flipped to.
    let size: Size | null = null
    const reposition = (): void => {
      if (!buttonRef.current || !menuRef.current) return
      size ??= { width: menuRef.current.offsetWidth, height: menuRef.current.offsetHeight }
      setPlacement(
        placeMenu(buttonRef.current.getBoundingClientRect(), size, {
          width: window.innerWidth,
          height: window.innerHeight
        })
      )
    }
    reposition()
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [open])

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        ref={buttonRef}
        className={`icon-btn ${open ? 'on' : ''}`}
        title="Panel menu"
        onClick={() => onOpenChange(!open)}
      >
        ⋯
      </button>
      {open && (
        <div
          className="menu"
          ref={menuRef}
          style={placement ? { ...placement } : { visibility: 'hidden' }}
        >
          {items.map((item, index) =>
            item.separator ? (
              <div key={`sep-${index}`} className="menu-sep" />
            ) : (
              <button
                key={item.label}
                className={`menu-item ${item.danger ? 'danger' : ''} ${
                  item.disabled ? 'disabled' : ''
                }`}
                data-menu-item={item.id}
                /* Not the `disabled` attribute: Chromium suppresses the
                   tooltip on a disabled control, and the tooltip is the entire
                   explanation this row has. */
                aria-disabled={item.disabled ? true : undefined}
                title={item.disabled ? `Unavailable — ${item.disabled}` : undefined}
                onClick={() => {
                  // Left open on purpose. A menu that closed on a dead row
                  // would take the tooltip with it before it could be read.
                  if (item.disabled) return
                  onOpenChange(false)
                  item.onSelect?.()
                }}
              >
                <span className="menu-label">{item.label}</span>
                {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
