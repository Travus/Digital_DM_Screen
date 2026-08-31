/**
 * Structural check for a data pack file, mirroring `parseLayoutDoc`: strict
 * about the shape, permissive about extras, and returning null rather than
 * throwing so the caller decides what a bad file means.
 *
 * Unknown top-level sections are *kept* rather than rejected. That is how a
 * later version adds a section without a format bump — an older app warns and
 * ignores it rather than refusing the file, which is the route `nameStyles` and
 * the flesh-out lines took in.
 */

import {
  DATAPACK_FORMAT_VERSION,
  type AbilityGroup,
  type DataPack,
  type PackNameStyle,
  type ReferenceEntry,
  type RuleItem,
  type RuleSection,
  type RuleTable
} from './types'

/** The four flat pools the name generator fleshes an entry out from. */
export const FLESH_OUT_SECTIONS = ['traits', 'wants', 'placeDetails', 'placeHooks'] as const

export type FleshOutSection = (typeof FLESH_OUT_SECTIONS)[number]

const KNOWN_SECTIONS: string[] = [
  'conditions',
  'rules',
  'abilityGroups',
  'diseases',
  'nameStyles',
  ...FLESH_OUT_SECTIONS
]

/** Ids are namespaced per pack, so this only has to be a sane identifier. */
const ID = /^[a-z0-9][a-z0-9-]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseEntry(value: unknown): ReferenceEntry | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null
  if (typeof value.name !== 'string' || value.name.trim() === '') return null
  if (typeof value.summary !== 'string') return null
  if (!isStringArray(value.lines)) return null

  return {
    id: value.id,
    name: value.name,
    summary: value.summary,
    lines: value.lines,
    meta: typeof value.meta === 'string' ? value.meta : undefined,
    note: typeof value.note === 'string' ? value.note : undefined
  }
}

function parseAbilityGroup(value: unknown): AbilityGroup | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null
  if (!Array.isArray(value.entries)) return null

  const entries: ReferenceEntry[] = []
  for (const raw of value.entries) {
    const entry = parseEntry(raw)
    if (!entry) return null
    entries.push(entry)
  }

  // title and blurb are optional here because a group that extends one already
  // loaded inherits them. Creating a group without a title is caught at merge
  // time, where we know whether anything else supplied one.
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    blurb: typeof value.blurb === 'string' ? value.blurb : '',
    entries
  }
}

/**
 * Only the id is required. Every other field belongs to whichever source
 * declares the pool first, so a pack extending one states nothing but syllables
 * — and one creating a pool is checked at merge time, where we know whether
 * anything else supplied what it left out.
 */
function parseNameStyle(value: unknown): PackNameStyle | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null
  if (value.kind !== undefined && value.kind !== 'person' && value.kind !== 'place') return null
  if (value.prefix !== undefined && !isStringArray(value.prefix)) return null
  if (value.middle !== undefined && !isStringArray(value.middle)) return null
  if (value.suffix !== undefined && !isStringArray(value.suffix)) return null
  if (value.middleChance !== undefined && !Number.isFinite(value.middleChance)) return null

  return {
    id: value.id,
    label: typeof value.label === 'string' && value.label.trim() !== '' ? value.label : undefined,
    kind: value.kind,
    prefix: value.prefix,
    middle: value.middle,
    suffix: value.suffix,
    // Clamped rather than refused. A chance outside 0–1 is a wrong number, not a
    // wrong shape, and failing the whole file over it would take four working
    // sections down with a message that could not say which one was at fault.
    middleChance:
      value.middleChance === undefined
        ? undefined
        : Math.min(1, Math.max(0, value.middleChance as number))
  }
}

function parseRuleItem(value: unknown): RuleItem | null {
  if (!isRecord(value)) return null
  if (typeof value.term !== 'string' || value.term.trim() === '') return null
  if (typeof value.text !== 'string') return null
  return { term: value.term, text: value.text }
}

function parseRuleTable(value: unknown): RuleTable | null {
  if (!isRecord(value)) return null
  if (!isStringArray(value.head)) return null
  if (!Array.isArray(value.rows) || !value.rows.every(isStringArray)) return null
  return {
    caption: typeof value.caption === 'string' ? value.caption : undefined,
    head: value.head,
    rows: value.rows
  }
}

function parseRuleSection(value: unknown): RuleSection | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null

  let items: RuleItem[] | undefined
  if (value.items !== undefined) {
    if (!Array.isArray(value.items)) return null
    items = []
    for (const raw of value.items) {
      const item = parseRuleItem(raw)
      if (!item) return null
      items.push(item)
    }
  }

  let tables: RuleTable[] | undefined
  if (value.tables !== undefined) {
    if (!Array.isArray(value.tables)) return null
    tables = []
    for (const raw of value.tables) {
      const table = parseRuleTable(raw)
      if (!table) return null
      tables.push(table)
    }
  }

  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : '',
    items,
    tables,
    note: typeof value.note === 'string' ? value.note : undefined
  }
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return null

  const out: T[] = []
  for (const raw of value) {
    const item = parse(raw)
    if (!item) return null
    out.push(item)
  }
  return out
}

export interface ParsedPack {
  pack: DataPack
  /** Sections this build doesn't understand. Surfaced, not fatal. */
  unknownSections: string[]
}

export function parseDataPack(value: unknown): ParsedPack | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null
  // Reserved: the app's own content uses it, and a pack claiming it would
  // collapse the namespacing that makes cross-source collisions impossible.
  if (value.id === 'bundled') return null
  if (typeof value.name !== 'string' || value.name.trim() === '') return null

  const version = typeof value.formatVersion === 'number' ? value.formatVersion : 0
  if (version < 1 || version > DATAPACK_FORMAT_VERSION) return null

  const conditions = parseList(value.conditions, parseEntry)
  const diseases = parseList(value.diseases, parseEntry)
  const abilityGroups = parseList(value.abilityGroups, parseAbilityGroup)
  const rules = parseList(value.rules, parseRuleSection)
  const nameStyles = parseList(value.nameStyles, parseNameStyle)
  if (
    conditions === null ||
    diseases === null ||
    abilityGroups === null ||
    rules === null ||
    nameStyles === null
  ) {
    return null
  }

  // The flesh-out lines are bare strings, so there is nothing to parse past the
  // shape of the list itself.
  const lines: Record<FleshOutSection, string[] | undefined> = {
    traits: undefined,
    wants: undefined,
    placeDetails: undefined,
    placeHooks: undefined
  }
  for (const section of FLESH_OUT_SECTIONS) {
    const raw = value[section]
    if (raw === undefined) continue
    if (!isStringArray(raw)) return null
    lines[section] = raw
  }

  const unknownSections = Object.keys(value).filter(
    (key) =>
      !KNOWN_SECTIONS.includes(key) &&
      !['formatVersion', 'id', 'name', 'description', '$schema'].includes(key)
  )

  return {
    pack: {
      formatVersion: version,
      id: value.id,
      name: value.name,
      description: typeof value.description === 'string' ? value.description : undefined,
      conditions,
      rules,
      abilityGroups,
      diseases,
      nameStyles,
      ...lines
    },
    unknownSections
  }
}
