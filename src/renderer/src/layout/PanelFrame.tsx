import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PanelNode } from '../../../shared/types'
import { EMPTY_MODULE_ID, findParent } from '../../../shared/layout'
import { getModule } from '../modules/registry'
import { useAppStore } from '../state/store'
import { primaryModifier } from '../lib/platform'
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

  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [picking, setPicking] = useState(false)

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
            onClick={() => setPicking((open) => !open)}
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
          <button
            className="icon-btn"
            title={
              maximized
                ? 'Return to normal view (Esc)'
                : `Fullscreen this panel (${primaryModifier}+Enter)`
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
              // Everything structural disappears while the layout is locked.
              ...(locked
                ? []
                : [
                    { separator: true },
                    { label: 'Split right', onSelect: () => splitPanel(node.id, 'row') },
                    { label: 'Split down', onSelect: () => splitPanel(node.id, 'column') },
                    ...(parentSplitId
                      ? [
                          {
                            label: 'Flip surrounding split',
                            onSelect: () => flipSplit(parentSplitId)
                          },
                          {
                            label: 'Even out surrounding split',
                            onSelect: () => equalise(parentSplitId)
                          }
                        ]
                      : []),
                    { separator: true },
                    { label: 'Close panel', danger: true, onSelect: () => closePanel(node.id) }
                  ])
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

  useEffect(() => {
    if (!open) return
    const onDocumentPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown)
  }, [open, onOpenChange])

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className={`icon-btn ${open ? 'on' : ''}`}
        title="Panel menu"
        onClick={() => onOpenChange(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="menu">
          {items.map((item, index) =>
            item.separator ? (
              <div key={`sep-${index}`} className="menu-sep" />
            ) : (
              <button
                key={item.label}
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                onClick={() => {
                  onOpenChange(false)
                  item.onSelect?.()
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
