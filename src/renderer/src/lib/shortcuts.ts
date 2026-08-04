import { primaryModifier } from './platform'

/**
 * Display labels for the accelerators declared in `src/main/menu.ts`, which owns
 * the real bindings — these are captions, not keymaps, and binding nothing.
 *
 * Collected in one place because the same shortcut is now shown in up to three
 * spots at once: on the button itself, in its tooltip, and in the About dialog's
 * list. Editing an accelerator in menu.ts still means editing it here too.
 */
export const shortcuts = {
  newLayout: `${primaryModifier}+N`,
  openLayout: `${primaryModifier}+O`,
  save: `${primaryModifier}+S`,
  saveAs: `${primaryModifier}+Shift+S`,
  rename: 'F2',
  toggleLock: `${primaryModifier}+L`,
  splitRight: `${primaryModifier}+\\`,
  splitDown: `${primaryModifier}+Shift+\\`,
  maximize: `${primaryModifier}+Enter`,
  restore: 'Esc',
  closePanel: `${primaryModifier}+W`,
  importPack: `${primaryModifier}+I`
} as const
