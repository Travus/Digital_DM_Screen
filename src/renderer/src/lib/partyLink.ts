/**
 * Shared plumbing for keeping the Initiative Tracker's AC and HP in step with a
 * Party Tracker panel in the same layout.
 *
 * A combatant imported from a party panel remembers where it came from. While
 * sync is on, that party panel is the single source of truth for those two
 * values: initiative reads them live and writes edits straight back, so there is
 * never a stale copy to reconcile.
 */
import type { PanelData } from '../../../shared/types'
import { defaultPartyFields, type PartyCharacter, type PartyField } from '../modules/PartyModule'

export interface PartyLink {
  panelId: string
  characterId: string
}

export interface LinkedStats {
  ac: number | null
  hpCurrent: number | null
  hpMax: number | null
}

/** Columns are matched by label, so a party panel opts in by naming them this way. */
const AC_LABEL = /^ac$/i
const HP_LABEL = /^hp$/i

/**
 * Panel state only stores what the user has changed, so an untouched party
 * panel has no `fields` of its own and is still showing the module's defaults.
 * Falling back to those is what makes sync work out of the box rather than only
 * after someone has opened the column settings.
 */
function fieldsOf(panel: PanelData): PartyField[] {
  return (panel.state.fields as PartyField[] | undefined) ?? defaultPartyFields()
}

function charactersOf(panel: PanelData): PartyCharacter[] {
  return (panel.state.characters as PartyCharacter[] | undefined) ?? []
}

export function isPartyPanel(panel: PanelData): boolean {
  return panel.moduleId === 'party'
}

export function findAcField(panel: PanelData): PartyField | undefined {
  return fieldsOf(panel).find((field) => field.type === 'number' && AC_LABEL.test(field.label.trim()))
}

export function findHpField(panel: PanelData): PartyField | undefined {
  return fieldsOf(panel).find((field) => field.type === 'meter' && HP_LABEL.test(field.label.trim()))
}

export function findCharacter(
  panels: Record<string, PanelData>,
  link: PartyLink | undefined
): PartyCharacter | undefined {
  if (!link) return undefined
  const panel = panels[link.panelId]
  if (!panel || !isPartyPanel(panel)) return undefined
  return charactersOf(panel).find((character) => character.id === link.characterId)
}

/**
 * Current AC/HP for a linked combatant. A null field means the party panel has
 * no column of that name, so initiative keeps using its own value for it.
 */
export function readLinkedStats(
  panels: Record<string, PanelData>,
  link: PartyLink | undefined
): LinkedStats | null {
  if (!link) return null
  const panel = panels[link.panelId]
  if (!panel || !isPartyPanel(panel)) return null
  const character = charactersOf(panel).find((entry) => entry.id === link.characterId)
  if (!character) return null

  const acField = findAcField(panel)
  const hpField = findHpField(panel)
  const hp = hpField
    ? (character.values[hpField.id] as { current?: number; max?: number } | undefined)
    : undefined

  return {
    ac: acField ? Number(character.values[acField.id]) || 0 : null,
    hpCurrent: hpField ? (typeof hp?.current === 'number' ? hp.current : 0) : null,
    hpMax: hpField ? (typeof hp?.max === 'number' ? hp.max : 0) : null
  }
}

/**
 * Produces the party panel's new `characters` array with one combatant's edit
 * applied. Returns null when there is nothing to write — no link, no matching
 * column, or the character has since been deleted.
 */
export function applyStatToParty(
  panels: Record<string, PanelData>,
  link: PartyLink,
  change: { ac?: number; hpCurrent?: number; hpMax?: number }
): PartyCharacter[] | null {
  const panel = panels[link.panelId]
  if (!panel || !isPartyPanel(panel)) return null

  const characters = charactersOf(panel)
  const index = characters.findIndex((entry) => entry.id === link.characterId)
  if (index < 0) return null

  const acField = findAcField(panel)
  const hpField = findHpField(panel)
  const values = { ...characters[index].values }
  let touched = false

  if (change.ac !== undefined && acField) {
    values[acField.id] = change.ac
    touched = true
  }

  if ((change.hpCurrent !== undefined || change.hpMax !== undefined) && hpField) {
    const existing = (values[hpField.id] ?? {}) as { current?: number; max?: number }
    values[hpField.id] = {
      current: change.hpCurrent ?? existing.current ?? 0,
      max: change.hpMax ?? existing.max ?? 0
    }
    touched = true
  }

  if (!touched) return null

  const next = [...characters]
  next[index] = { ...characters[index], values }
  return next
}
