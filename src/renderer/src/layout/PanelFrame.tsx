import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PanelNode } from '../../../shared/types'
import { actionUnavailable, type ActionContext } from '../../../shared/actions'
import { EMPTY_MODULE_ID, findParent } from '../../../shared/layout'
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
  const locked = useAppStore((state) => state.doc.locked)
  const anyMaximized = useAppStore((state) => state.maximizedNodeId !== null)

  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
    hasSplit: parentSplitId !== null
  }

  return (
    <section
      className={`panel ${maximized ? 'maximized' : ''} ${active ? 'active' : ''}`}
      onPointerDownCapture={() => setActive(node.id)}
    >
      <header className="panel-head">
        <span className="panel-icon">{module?.icon ?? '▫'}</span>

        {renaming ? (
          <input
            className="panel-title-input"
            autoFocus
            defaultValue={panel.title ?? module?.name ?? ''}
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
            title="Double-click to rename this panel"
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
              { label: 'Change module…', onSelect: () => setPicking(true) },
              { label: 'Rename panel…', onSelect: () => setRenaming(true) },
              ...(panel.title
                ? [
                    {
                      label: 'Reset panel name',
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
                label: 'Split right',
                shortcut: shortcuts['panel:splitRight'],
                disabled: actionUnavailable('panel:splitRight', context),
                onSelect: () => splitPanel(node.id, 'row')
              },
              {
                label: 'Split down',
                shortcut: shortcuts['panel:splitDown'],
                disabled: actionUnavailable('panel:splitDown', context),
                onSelect: () => splitPanel(node.id, 'column')
              },
              {
                label: 'Flip surrounding split',
                disabled: actionUnavailable('split:flip', context),
                onSelect: () => {
                  if (parentSplitId) flipSplit(parentSplitId)
                }
              },
              {
                label: 'Even out surrounding split',
                disabled: actionUnavailable('split:equalise', context),
                onSelect: () => {
                  if (parentSplitId) equalise(parentSplitId)
                }
              },
              { separator: true },
              {
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
