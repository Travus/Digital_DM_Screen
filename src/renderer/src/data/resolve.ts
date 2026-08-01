/**
 * Merges the app's own reference data with whatever data packs are loaded.
 *
 * Rules, in one place because they are easy to get subtly wrong:
 *
 * - Packs **add**. Nothing a pack contains replaces a whole source; the
 *   bundled-content switches are how you drop duplicates.
 * - **Containers extend, entries don't.** An ability group or rule section whose
 *   id matches one already loaded merges its contents in, so a pack can add a
 *   single option without restating the rest. Scalars on a container (title,
 *   blurb, note) are first-wins — a pack may fill in what's absent, never
 *   overwrite what is there.
 * - **Condition names must be unique across every enabled source.** Names are
 *   the key the cross-reference popovers scan for, so two sources defining
 *   "Blinded" is ambiguous regardless of their ids.
 *
 * This function is **total**: it reports problems in `warnings` and never
 * throws. The only UI for removing a bad pack lives in the native menu, so a
 * renderer that died on load would leave no way out.
 */

import type {
  AbilityGroup,
  DataPack,
  DataSnapshot,
  Dataset,
  ReferenceEntry,
  RuleSection
} from '../../../shared/types'
import { ABILITY_GROUPS } from './abilities'
import { CONDITIONS } from './conditions'
import { DISEASES } from './diseases'
import { NAME_STYLES, type NameStyle } from './names'
import { RULE_SECTIONS } from './rules'

export const BUNDLED_SOURCE_ID = 'bundled'

export interface ConditionIndex {
  /** Null when nothing is loaded — see `buildPattern`. */
  pattern: RegExp | null
  byLower: Map<string, ReferenceEntry>
}

export interface GameData {
  conditions: ReferenceEntry[]
  rules: RuleSection[]
  abilityGroups: AbilityGroup[]
  diseases: ReferenceEntry[]
  nameStyles: NameStyle[]
  conditionIndex: ConditionIndex
  /** Derived once — the initiative tracker renders this per combatant row. */
  conditionNames: string[]
  warnings: string[]
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Longest first so "Incapacitated" wins over any shorter overlapping name.
 *
 * Null for an empty list: an empty alternation compiles to `/\b()\b/gi`, which
 * matches the empty string at the first word boundary without advancing, and
 * hangs whatever loop is driving it.
 */
export function buildPattern(names: string[]): RegExp | null {
  const usable = names.filter((name) => name.trim().length > 0)
  if (usable.length === 0) return null

  const alternation = [...usable].sort((a, b) => b.length - a.length).map(escape).join('|')
  return new RegExp(`\\b(${alternation})\\b`, 'gi')
}

function buildConditionIndex(conditions: ReferenceEntry[]): ConditionIndex {
  return {
    pattern: buildPattern(conditions.map((condition) => condition.name)),
    byLower: new Map(conditions.map((condition) => [condition.name.toLowerCase(), condition]))
  }
}

/** Flat lists: append, warning on an id reused inside one source. */
function collectEntries(
  chunks: { sourceId: string; entries: ReferenceEntry[] }[],
  label: string,
  warnings: string[]
): ReferenceEntry[] {
  const out: ReferenceEntry[] = []

  for (const { sourceId, entries } of chunks) {
    const seen = new Set<string>()
    for (const entry of entries) {
      if (seen.has(entry.id)) {
        warnings.push(`${sourceId}: duplicate ${label} id "${entry.id}"`)
        continue
      }
      seen.add(entry.id)
      out.push(entry)
    }
  }

  return out
}

function collectAbilityGroups(
  chunks: { sourceId: string; groups: AbilityGroup[] }[],
  warnings: string[]
): AbilityGroup[] {
  const byId = new Map<string, AbilityGroup>()
  const order: string[] = []

  for (const { sourceId, groups } of chunks) {
    for (const group of groups) {
      const existing = byId.get(group.id)
      if (!existing) {
        byId.set(group.id, { ...group, entries: [...group.entries] })
        order.push(group.id)
        continue
      }

      // Extend: first source to name the tab keeps its title and blurb.
      existing.title ||= group.title
      existing.blurb ||= group.blurb

      const seen = new Set(existing.entries.map((entry) => entry.id))
      for (const entry of group.entries) {
        if (seen.has(entry.id)) {
          warnings.push(`${sourceId}: duplicate ability id "${entry.id}" in group "${group.id}"`)
          continue
        }
        seen.add(entry.id)
        existing.entries.push(entry)
      }
    }
  }

  const groups = order.map((id) => byId.get(id) as AbilityGroup)
  for (const group of groups) {
    if (!group.title) warnings.push(`ability group "${group.id}" has no title`)
  }
  return groups
}

function collectRuleSections(
  chunks: { sourceId: string; sections: RuleSection[] }[],
  warnings: string[]
): RuleSection[] {
  const byId = new Map<string, RuleSection>()
  const order: string[] = []

  for (const { sections } of chunks) {
    for (const section of sections) {
      const existing = byId.get(section.id)
      if (!existing) {
        byId.set(section.id, {
          ...section,
          items: section.items ? [...section.items] : undefined,
          tables: section.tables ? [...section.tables] : undefined
        })
        order.push(section.id)
        continue
      }

      existing.title ||= section.title
      existing.note ??= section.note
      if (section.items?.length) existing.items = [...(existing.items ?? []), ...section.items]
      if (section.tables?.length) existing.tables = [...(existing.tables ?? []), ...section.tables]
    }
  }

  const sections = order.map((id) => byId.get(id) as RuleSection)
  for (const section of sections) {
    if (!section.title) warnings.push(`rule section "${section.id}" has no title`)
  }
  return sections
}

/** Names are the popover key, so a clash matters even across different ids. */
function warnOnDuplicateNames(conditions: ReferenceEntry[], warnings: string[]): void {
  const seen = new Set<string>()
  for (const condition of conditions) {
    const key = condition.name.toLowerCase()
    if (seen.has(key)) warnings.push(`more than one source defines the condition "${condition.name}"`)
    seen.add(key)
  }
}

function bundledFor<T>(enabled: Record<Dataset, boolean>, dataset: Dataset, value: T[]): T[] {
  return enabled[dataset] ? value : []
}

export function resolve(snapshot: DataSnapshot): GameData {
  const warnings: string[] = []
  const { enabled, packs } = snapshot

  for (const failure of snapshot.failed) {
    warnings.push(`${failure.path} ${failure.reason}`)
  }

  const source = (pack: DataPack): string => pack.id

  const conditions = collectEntries(
    [
      { sourceId: BUNDLED_SOURCE_ID, entries: bundledFor(enabled, 'conditions', CONDITIONS) },
      ...packs.map((pack) => ({ sourceId: source(pack), entries: pack.conditions ?? [] }))
    ],
    'condition',
    warnings
  )
  warnOnDuplicateNames(conditions, warnings)

  const diseases = collectEntries(
    [
      { sourceId: BUNDLED_SOURCE_ID, entries: bundledFor(enabled, 'diseases', DISEASES) },
      ...packs.map((pack) => ({ sourceId: source(pack), entries: pack.diseases ?? [] }))
    ],
    'disease',
    warnings
  )

  const abilityGroups = collectAbilityGroups(
    [
      { sourceId: BUNDLED_SOURCE_ID, groups: bundledFor(enabled, 'abilities', ABILITY_GROUPS) },
      ...packs.map((pack) => ({ sourceId: source(pack), groups: pack.abilityGroups ?? [] }))
    ],
    warnings
  )

  const rules = collectRuleSections(
    [
      { sourceId: BUNDLED_SOURCE_ID, sections: bundledFor(enabled, 'rules', RULE_SECTIONS) },
      ...packs.map((pack) => ({ sourceId: source(pack), sections: pack.rules ?? [] }))
    ],
    warnings
  )

  return {
    conditions,
    rules,
    abilityGroups,
    diseases,
    // Packs cannot carry name pools yet; the switch still gates the built-in ones.
    nameStyles: bundledFor(enabled, 'names', NAME_STYLES),
    conditionIndex: buildConditionIndex(conditions),
    conditionNames: conditions.map((condition) => condition.name),
    warnings
  }
}
