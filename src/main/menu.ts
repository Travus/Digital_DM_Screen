import { app, Menu } from 'electron'
import type { DataSnapshot, RecentEntry } from '../shared/types'
import type { ResolvedKeymap } from '../shared/actions'
import { menuTemplate, type DataActions, type MenuDispatch } from './menuTemplate'

export type { DataActions, MenuDispatch }

/**
 * Installs the application menu.
 *
 * The template itself is `menuTemplate`, which knows nothing about Electron and
 * takes the platform as a parameter — everything worth asserting about this menu
 * is asserted there. What is left here is the one step that needs a running app,
 * and `buildFromTemplate` throwing on a malformed accelerator is why the template
 * refuses to emit one.
 */
export function buildMenu(
  recents: RecentEntry[],
  data: DataSnapshot,
  keymap: ResolvedKeymap,
  dispatch: MenuDispatch,
  dataActions: DataActions
): void {
  const template = menuTemplate({
    recents,
    data,
    keymap,
    dispatch,
    dataActions,
    platform: process.platform,
    appName: app.getName()
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
