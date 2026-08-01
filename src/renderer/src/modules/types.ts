import type { ComponentType } from 'react'

export interface ModuleProps<S = unknown, C = unknown> {
  /** Persisted module state, already merged over the module's defaults. */
  state: S
  /** Shallow-merges a patch into state. Pass a function to derive it from the previous state. */
  setState: (patch: Partial<S> | ((prev: S) => Partial<S>)) => void
  /** Persisted user settings, already merged over the module's defaults. */
  settings: C
  setSettings: (patch: Partial<C> | ((prev: C) => Partial<C>)) => void
  panelId: string
  /** True while this panel is rendered fullscreen — handy for denser vs. roomier layouts. */
  maximized: boolean
}

export type ModuleCategory = 'Reference' | 'Tracking' | 'Tools'

export interface ModuleDefinition<S = never, C = never> {
  id: string
  name: string
  /** Single emoji shown in the picker and panel header. */
  icon: string
  blurb: string
  category: ModuleCategory
  defaultState: () => S
  defaultSettings: () => C
  Component: ComponentType<ModuleProps<S, C>>
  /** Rendered in the panel's settings drawer. Panels without one hide the gear button. */
  Settings?: ComponentType<ModuleProps<S, C>>
}

/**
 * The registry is heterogeneous by nature — each module has its own state and
 * settings shapes, and the panel host reunites them at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModule = ModuleDefinition<any, any>

/** Convenience for defining a module without repeating its generics. */
export function defineModule<S, C>(definition: ModuleDefinition<S, C>): ModuleDefinition<S, C> {
  return definition
}
