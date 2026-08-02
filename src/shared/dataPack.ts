/**
 * Structural check for a data pack file, mirroring `parseLayoutDoc`: strict
 * about the shape, permissive about extras, and returning null rather than
 * throwing so the caller decides what a bad file means.
 *
 * Unknown top-level sections are *kept* rather than rejected. That is what lets
 * a later version add `nameStyles` without a format bump — an older app warns
 * and ignores it instead of refusing the file.
 */

import {
  DATAPACK_FORMAT_VERSION,
  type AbilityGroup,
  type DataPack,
  type ReferenceEntry,
  type RuleItem,
  type RuleSection,
  type RuleTable
} from './types'

const KNOWN_SECTIONS = ['conditions', 'rules', 'abilityGroups', 'diseases']

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
  if (conditions === null || diseases === null || abilityGroups === null || rules === null) {
    return null
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
      diseases
    },
    unknownSections
  }
}
