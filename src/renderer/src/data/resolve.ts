/**
 * Merges the app's own reference data with whatever data packs are loaded.
 *
 * Rules, in one place because they are easy to get subtly wrong:
 *
 * - Packs **add**. Nothing a pack contains replaces a whole source; the
 *   bundled-content switches are how you drop duplicates.
 * - **Containers extend, entries don't.** An ability group, rule section or name
 *   pool whose id matches one already loaded merges its contents in, so a pack
 *   can add a single option without restating the rest. Scalars on a container
 *   (title, blurb, note, a pool's label and kind) are first-wins — a pack may
 *   fill in what's absent, never overwrite what is there.
 * - **The bundled switches gate the bundled content only.** Turning the name
 *   pools off leaves a pack's pools standing, which is what makes replacing them
 *   wholesale possible rather than merely turning the module off.
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
  NameStyle,
  PackNameStyle,
  ReferenceEntry,
  RuleSection
} from '../../../shared/types'
import { ABILITY_GROUPS } from './abilities'
import { CONDITIONS } from './conditions'
import { DISEASES } from './diseases'
import { NAME_STYLES, PLACE_DETAILS, PLACE_HOOKS, TRAITS, WANTS } from './names'
import { RULE_SECTIONS } from './rules'

export const BUNDLED_SOURCE_ID = 'bundled'

/**
 * Entry ids are qualified by the source that supplied them, so the same id in
 * two sources cannot collide. Without this, starring the bundled "Careful Spell"
 * would also star a pack's copy — they share a favourites key and a React key.
 *
 * Container ids (ability groups, rule sections) are deliberately *not* qualified:
 * matching ids across sources is exactly how a pack extends a tab, and
 * `defaultState()` refers to them by literal.
 */
export function qualify(sourceId: string, id: string): string {
  return `${sourceId}:${id}`
}

/** Brings ids persisted before qualification into the current scheme. */
export function migrateIds(ids: string[]): string[] {
  return ids.map((id) => (id.includes(':') ? id : qualify(BUNDLED_SOURCE_ID, id)))
}

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
  /**
   * The flesh-out lines, which belong to no one pool. Resolved here rather than
   * imported by the module, so the bundled switch and a pack reach them by the
   * same route everything else in this file takes.
   */
  traits: string[]
  wants: string[]
  placeDetails: string[]
  placeHooks: string[]
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

  const alternation = [...usable]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|')
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
      out.push({ ...entry, id: qualify(sourceId, entry.id) })
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
      // Group ids stay bare — that is what lets a pack extend an existing tab.
      const qualified = group.entries.map((entry) => ({
        ...entry,
        id: qualify(sourceId, entry.id)
      }))

      const existing = byId.get(group.id)
      if (!existing) {
        byId.set(group.id, { ...group, entries: qualified })
        order.push(group.id)
        continue
      }

      // Extend: first source to name the tab keeps its title and blurb.
      existing.title ||= group.title
      existing.blurb ||= group.blurb

      const seen = new Set(existing.entries.map((entry) => entry.id))
      for (const entry of qualified) {
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

/**
 * A pool creating itself without one gets no `middleChance` from anywhere, and
 * middles it can never insert are worse than no middles at all. The bundled
 * pools all state their own; this is only ever a pack's default.
 */
const DEFAULT_MIDDLE_CHANCE = 0.35

/**
 * Trimmed, blanks dropped, repeats collapsed, in the order the sources arrived.
 *
 * A pool is drawn from uniformly, so a pack that restates what it is extending
 * would quietly double the odds of every syllable it copied — which shows up in
 * the output as nothing at all, and cannot be debugged from it.
 */
function pooled(...chunks: (string[] | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const chunk of chunks) {
    for (const value of chunk ?? []) {
      const trimmed = value.trim()
      if (trimmed === '' || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

/**
 * Name pools merge the way ability groups do: the first source to use an id
 * creates the pool and settles what it is called and how it is built, and every
 * later source adds syllables to it. That is what lets a pack add six dwarven
 * endings without restating the pool, and it is why pool ids are not namespaced.
 *
 * The one contradiction worth reporting is `kind`. A pack meaning to declare a
 * place and landing on a person pool gets quirks and motives where it wanted
 * details and hooks, which reads as the flesh-out button being broken.
 */
function collectNameStyles(
  chunks: { sourceId: string; styles: PackNameStyle[] }[],
  warnings: string[]
): NameStyle[] {
  const byId = new Map<string, NameStyle>()
  const order: string[] = []

  for (const { sourceId, styles } of chunks) {
    for (const style of styles) {
      const existing = byId.get(style.id)
      if (!existing) {
        byId.set(style.id, {
          id: style.id,
          label: style.label ?? '',
          kind: style.kind ?? 'person',
          prefix: pooled(style.prefix),
          middle: pooled(style.middle),
          suffix: pooled(style.suffix),
          middleChance: style.middleChance ?? DEFAULT_MIDDLE_CHANCE
        })
        order.push(style.id)
        continue
      }

      if (style.kind && style.kind !== existing.kind) {
        warnings.push(`${sourceId}: name pool "${style.id}" is already a ${existing.kind} pool`)
      }

      // Extend: first source to name the pool keeps its label and its shape.
      existing.label ||= style.label ?? ''
      existing.prefix = pooled(existing.prefix, style.prefix)
      existing.middle = pooled(existing.middle, style.middle)
      existing.suffix = pooled(existing.suffix, style.suffix)
    }
  }

  const usable: NameStyle[] = []
  for (const id of order) {
    const pool = byId.get(id) as NameStyle

    // Nothing to build a name out of. Every draw would come back empty, so the
    // panel would offer the pool and then fill with blank chips — dropped rather
    // than shown broken, which is the one thing the module cannot report itself.
    if (pool.prefix.length === 0 && pool.suffix.length === 0) {
      warnings.push(`name pool "${pool.id}" has no prefix or suffix syllables`)
      continue
    }

    // An ability group with no title is still a tab you can see and click. An
    // unlabelled pool is a `<select>` row with nothing in it, so it falls back
    // to the id — which is at least something the pack's author wrote.
    if (!pool.label) {
      warnings.push(`name pool "${pool.id}" has no label`)
      pool.label = pool.id
    }
    usable.push(pool)
  }
  return usable
}

/** Names are the popover key, so a clash matters even across different ids. */
function warnOnDuplicateNames(conditions: ReferenceEntry[], warnings: string[]): void {
  const seen = new Set<string>()
  for (const condition of conditions) {
    const key = condition.name.toLowerCase()
    if (seen.has(key))
      warnings.push(`more than one source defines the condition "${condition.name}"`)
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

  const nameStyles = collectNameStyles(
    [
      { sourceId: BUNDLED_SOURCE_ID, styles: bundledFor(enabled, 'names', NAME_STYLES) },
      ...packs.map((pack) => ({ sourceId: source(pack), styles: pack.nameStyles ?? [] }))
    ],
    warnings
  )

  // The switch gates the bundled lists and nothing else, so turning it off makes
  // room for a pack's pools rather than emptying the module.
  const lines = (bundled: string[], from: (pack: DataPack) => string[] | undefined): string[] =>
    pooled(bundledFor(enabled, 'names', bundled), ...packs.map(from))

  return {
    conditions,
    rules,
    abilityGroups,
    diseases,
    nameStyles,
    traits: lines(TRAITS, (pack) => pack.traits),
    wants: lines(WANTS, (pack) => pack.wants),
    placeDetails: lines(PLACE_DETAILS, (pack) => pack.placeDetails),
    placeHooks: lines(PLACE_HOOKS, (pack) => pack.placeHooks),
    conditionIndex: buildConditionIndex(conditions),
    conditionNames: conditions.map((condition) => condition.name),
    warnings
  }
}
