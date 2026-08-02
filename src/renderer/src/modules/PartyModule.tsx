import { useMemo, useRef, useState } from 'react'
import { uid } from '../../../shared/layout'
import { NumberInput } from '../components/NumberInput'
import { SYMBOL_GROUPS, isPlainGlyph } from '../data/symbols'
import { defineModule, type ModuleProps } from './types'

export type FieldType = 'text' | 'number' | 'meter' | 'check' | 'symbols'

/** A symbol gets a stable id so reordering or repeating a glyph stays coherent. */
export interface SymbolSlot {
  id: string
  char: string
}

export interface PartyField {
  id: string
  label: string
  type: FieldType
  /** Only for type 'symbols' — which glyphs this column offers. */
  symbols?: SymbolSlot[]
}

export interface PartyCharacter {
  id: string
  name: string
  values: Record<string, unknown>
}

interface State {
  fields: PartyField[]
  characters: PartyCharacter[]
  /** Keyed by field id, plus the built-in '__name' and '__player' columns. */
  columnWidths: Record<string, number>
}

interface Settings {
  compact: boolean
  showPlayerColumn: boolean
}

interface Meter {
  current: number
  max: number
}

/**
 * The columns a party panel starts with.
 *
 * Exported because panel state is sparse — it only holds what the user has
 * actually changed, and defaults are merged in at render time. Another panel
 * reading this one's `state.fields` directly would see nothing until the
 * columns had been edited, so cross-panel readers merge over this instead.
 */
export function defaultPartyFields(): PartyField[] {
  return [
    { id: 'ac', label: 'AC', type: 'number' },
    { id: 'hp', label: 'HP', type: 'meter' },
    { id: 'pp', label: 'Pass. Perc.', type: 'number' },
    { id: 'notes', label: 'Notes', type: 'text' }
  ]
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  meter: 'Meter (current / max)',
  check: 'Checkbox',
  symbols: 'Symbols (toggle each)'
}

const NAME_KEY = '__name'
const PLAYER_KEY = '__player'

const DEFAULT_WIDTH: Record<string, number> = {
  [NAME_KEY]: 150,
  [PLAYER_KEY]: 110,
  text: 175,
  number: 74,
  meter: 132,
  check: 62,
  symbols: 120
}

const MIN_COLUMN = 46
const MAX_COLUMN = 640
const ACTIONS_WIDTH = 80

function defaultValue(type: FieldType): unknown {
  switch (type) {
    case 'number':
      return 0
    case 'meter':
      return { current: 0, max: 0 } satisfies Meter
    case 'check':
      return false
    case 'symbols':
      return []
    default:
      return ''
  }
}

function asMeter(value: unknown): Meter {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Partial<Meter>
    return {
      current: typeof candidate.current === 'number' ? candidate.current : 0,
      max: typeof candidate.max === 'number' ? candidate.max : 0
    }
  }
  return { current: 0, max: 0 }
}

function asIdList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** A data column. The trailing spacer and row-actions columns are rendered separately. */
interface Column {
  key: string
  label: string
  width: number
  field?: PartyField
}

function Party({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const resizeRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)

  const columns = useMemo<Column[]>(() => {
    /**
     * An explicit width always wins. Otherwise take the type's default, but
     * widen it enough to show the header — a "Pass. Perc." column defaulting to
     * a number field's 74px would arrive with its own title truncated.
     */
    const widthOf = (key: string, fallbackKey: string, label: string): number => {
      const explicit = state.columnWidths[key]
      if (typeof explicit === 'number') return explicit
      const base = DEFAULT_WIDTH[fallbackKey] ?? 120
      return Math.min(220, Math.max(base, label.length * 7.2 + 26))
    }

    const list: Column[] = [
      { key: NAME_KEY, label: 'Character', width: widthOf(NAME_KEY, NAME_KEY, 'Character') }
    ]
    if (settings.showPlayerColumn) {
      list.push({
        key: PLAYER_KEY,
        label: 'Player',
        width: widthOf(PLAYER_KEY, PLAYER_KEY, 'Player')
      })
    }
    for (const field of state.fields) {
      list.push({
        key: field.id,
        label: field.label,
        width: widthOf(field.id, field.type, field.label),
        field
      })
    }
    return list
  }, [state.fields, state.columnWidths, settings.showPlayerColumn])

  const tableWidth = columns.reduce((sum, column) => sum + column.width, ACTIONS_WIDTH)

  const setCharacters = (updater: (characters: PartyCharacter[]) => PartyCharacter[]): void =>
    setState((prev) => ({ characters: updater(prev.characters) }))

  const setValue = (characterId: string, fieldId: string, value: unknown): void =>
    setCharacters((characters) =>
      characters.map((character) =>
        character.id === characterId
          ? { ...character, values: { ...character.values, [fieldId]: value } }
          : character
      )
    )

  const addCharacter = (): void =>
    setCharacters((characters) => [
      ...characters,
      {
        id: uid('pc'),
        name: '',
        values: Object.fromEntries(
          state.fields.map((field) => [field.id, defaultValue(field.type)])
        )
      }
    ])

  const move = (index: number, delta: number): void =>
    setCharacters((characters) => {
      const target = index + delta
      if (target < 0 || target >= characters.length) return characters
      const next = [...characters]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })

  const beginResize = (
    key: string,
    width: number,
    event: React.PointerEvent<HTMLSpanElement>
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = { key, startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onResize = (event: React.PointerEvent<HTMLSpanElement>): void => {
    const drag = resizeRef.current
    if (!drag) return
    const next = Math.round(
      Math.max(MIN_COLUMN, Math.min(MAX_COLUMN, drag.startWidth + (event.clientX - drag.startX)))
    )
    setState((prev) => ({ columnWidths: { ...prev.columnWidths, [drag.key]: next } }))
  }

  const endResize = (event: React.PointerEvent<HTMLSpanElement>): void => {
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /** Double-clicking a grip hands the column back to its default width. */
  const resetWidth = (key: string): void =>
    setState((prev) => {
      const columnWidths = { ...prev.columnWidths }
      delete columnWidths[key]
      return { columnWidths }
    })

  return (
    <div className={`stack ${settings.compact ? 'compact' : ''}`}>
      <div className="table-wrap">
        <table className="table grid resizable" style={{ minWidth: tableWidth }}>
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
            {/* Soaks up space when the panel is wider than the columns, so the
                actions column that follows stays pinned to the right edge. */}
            <col />
            <col style={{ width: ACTIONS_WIDTH }} />
          </colgroup>

          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>
                  <span className="th-label">{column.label}</span>
                  <span
                    className="col-resize"
                    title="Drag to resize · double-click to reset"
                    onPointerDown={(event) => beginResize(column.key, column.width, event)}
                    onPointerMove={onResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onDoubleClick={() => resetWidth(column.key)}
                  />
                </th>
              ))}
              <th />
              <th className="col-actions" />
            </tr>
          </thead>

          <tbody>
            {state.characters.map((character, index) => (
              <tr key={character.id}>
                <td>
                  <input
                    className="cell-input strong"
                    value={character.name}
                    placeholder="Name"
                    onChange={(event) =>
                      setCharacters((characters) =>
                        characters.map((entry) =>
                          entry.id === character.id ? { ...entry, name: event.target.value } : entry
                        )
                      )
                    }
                  />
                </td>

                {settings.showPlayerColumn && (
                  <td>
                    <input
                      className="cell-input dim"
                      value={
                        typeof character.values[PLAYER_KEY] === 'string'
                          ? character.values[PLAYER_KEY]
                          : ''
                      }
                      placeholder="Player"
                      onChange={(event) => setValue(character.id, PLAYER_KEY, event.target.value)}
                    />
                  </td>
                )}

                {state.fields.map((field) => (
                  <td key={field.id}>
                    <CellEditor
                      field={field}
                      value={character.values[field.id]}
                      onChange={(value) => setValue(character.id, field.id, value)}
                    />
                  </td>
                ))}

                <td />
                <td className="col-actions">
                  <div className="row-actions">
                    <button className="icon-btn" title="Move up" onClick={() => move(index, -1)}>
                      ↑
                    </button>
                    <button className="icon-btn" title="Move down" onClick={() => move(index, 1)}>
                      ↓
                    </button>
                    <button
                      className="icon-btn danger"
                      title="Remove character"
                      onClick={() =>
                        setCharacters((characters) =>
                          characters.filter((entry) => entry.id !== character.id)
                        )
                      }
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.characters.length === 0 && (
        <p className="empty">
          No party members yet. Add one, then define what you track in settings.
        </p>
      )}

      <div className="toolbar">
        <button className="btn primary" onClick={addCharacter}>
          + Add character
        </button>
        <span className="note">Columns are configured in this panel’s settings.</span>
      </div>
    </div>
  )
}

function CellEditor({
  field,
  value,
  onChange
}: {
  field: PartyField
  value: unknown
  onChange: (value: unknown) => void
}): JSX.Element {
  if (field.type === 'check') {
    return (
      <input
        type="checkbox"
        className="cell-check"
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  }

  if (field.type === 'symbols') {
    const slots = field.symbols ?? []
    if (slots.length === 0) {
      return <span className="cell-hint">no symbols yet</span>
    }
    const active = new Set(asIdList(value))
    return (
      <div className="symbol-cell">
        {slots.map((slot) => {
          const lit = active.has(slot.id)
          return (
            <button
              key={slot.id}
              className={`symbol ${lit ? 'lit' : 'dim'}`}
              title={lit ? 'Click to dim' : 'Click to light up'}
              onClick={() =>
                onChange(lit ? [...active].filter((id) => id !== slot.id) : [...active, slot.id])
              }
            >
              <span className={isPlainGlyph(slot.char) ? 'glyph' : 'emoji'}>{slot.char}</span>
            </button>
          )
        })}
      </div>
    )
  }

  if (field.type === 'number') {
    return <NumberInput className="cell-input num" value={toNumber(value)} onChange={onChange} />
  }

  if (field.type === 'meter') {
    const meter = asMeter(value)
    const pct = meter.max > 0 ? Math.max(0, Math.min(100, (meter.current / meter.max) * 100)) : 0
    const tone = pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok'
    return (
      <div className="meter">
        <div className="meter-inputs">
          <NumberInput
            className="cell-input num"
            title="Current"
            value={meter.current}
            onChange={(current) => onChange({ ...meter, current })}
          />
          <span className="slash">/</span>
          <NumberInput
            className="cell-input num"
            title="Maximum"
            value={meter.max}
            onChange={(max) => onChange({ ...meter, max })}
          />
        </div>
        <div className="meter-bar">
          <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    )
  }

  return (
    <input
      className="cell-input"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function SymbolEditor({
  field,
  onChange
}: {
  field: PartyField
  onChange: (symbols: SymbolSlot[]) => void
}): JSX.Element {
  const [custom, setCustom] = useState('')
  const slots = field.symbols ?? []
  const add = (char: string): void => onChange([...slots, { id: uid('sym'), char }])

  return (
    <div className="symbol-editor">
      <div className="symbol-chosen">
        {slots.length === 0 ? (
          <span className="note">Pick one or more symbols below.</span>
        ) : (
          slots.map((slot) => (
            <button
              key={slot.id}
              className="symbol chosen"
              title="Remove from this column"
              onClick={() => onChange(slots.filter((entry) => entry.id !== slot.id))}
            >
              <span className={isPlainGlyph(slot.char) ? 'glyph' : 'emoji'}>{slot.char}</span>
              <span className="symbol-remove">✕</span>
            </button>
          ))
        )}
      </div>

      {SYMBOL_GROUPS.map((group) => (
        <div key={group.label} className="symbol-group">
          <span className="symbol-group-label">{group.label}</span>
          <div className="symbol-palette">
            {group.symbols.map((char) => (
              <button
                key={char}
                className="symbol palette"
                title={`Add ${char}`}
                onClick={() => add(char)}
              >
                <span className={isPlainGlyph(char) ? 'glyph' : 'emoji'}>{char}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="toolbar">
        <input
          className="input grow"
          value={custom}
          maxLength={4}
          placeholder="…or paste any character"
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !custom.trim()) return
            add(custom.trim())
            setCustom('')
          }}
        />
        <button
          className="btn"
          disabled={!custom.trim()}
          onClick={() => {
            add(custom.trim())
            setCustom('')
          }}
        >
          Add
        </button>
      </div>
    </div>
  )
}

function PartySettings({
  state,
  setState,
  settings,
  setSettings
}: ModuleProps<State, Settings>): JSX.Element {
  const setFields = (updater: (fields: PartyField[]) => PartyField[]): void =>
    setState((prev) => ({ fields: updater(prev.fields) }))

  const addField = (): void =>
    setFields((fields) => [...fields, { id: uid('f'), label: 'New field', type: 'text' }])

  const moveField = (index: number, delta: number): void =>
    setFields((fields) => {
      const target = index + delta
      if (target < 0 || target >= fields.length) return fields
      const next = [...fields]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })

  /**
   * Changing a field's type would leave every character holding a value of the
   * old shape, so existing values are reset to the new type's default.
   */
  const changeType = (fieldId: string, type: FieldType): void =>
    setState((prev) => ({
      fields: prev.fields.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              type,
              // Seed a symbols column so it isn't empty on arrival.
              symbols:
                type === 'symbols' && !field.symbols?.length
                  ? [{ id: uid('sym'), char: '✨' }]
                  : field.symbols
            }
          : field
      ),
      characters: prev.characters.map((character) => ({
        ...character,
        values: { ...character.values, [fieldId]: defaultValue(type) }
      }))
    }))

  const removeField = (fieldId: string): void =>
    setState((prev) => {
      const columnWidths = { ...prev.columnWidths }
      delete columnWidths[fieldId]
      return {
        columnWidths,
        fields: prev.fields.filter((field) => field.id !== fieldId),
        characters: prev.characters.map((character) => {
          const values = { ...character.values }
          delete values[fieldId]
          return { ...character, values }
        })
      }
    })

  return (
    <div className="stack">
      <div className="stack tight">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.showPlayerColumn}
            onChange={(event) => setSettings({ showPlayerColumn: event.target.checked })}
          />
          Show a “Player” column
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.compact}
            onChange={(event) => setSettings({ compact: event.target.checked })}
          />
          Compact rows
        </label>
      </div>

      <div className="settings-section">
        <h4>Tracked columns</h4>
        <p className="note">
          Drag the divider at the right edge of any header to resize a column; double-click it to
          reset.
        </p>
        <div className="stack tight">
          {state.fields.map((field, index) => (
            <div key={field.id} className="stack tight">
              <div className="field-row">
                <input
                  className="input grow"
                  value={field.label}
                  onChange={(event) =>
                    setFields((fields) =>
                      fields.map((entry) =>
                        entry.id === field.id ? { ...entry, label: event.target.value } : entry
                      )
                    )
                  }
                />
                <select
                  className="input"
                  value={field.type}
                  onChange={(event) => changeType(field.id, event.target.value as FieldType)}
                >
                  {Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="icon-btn" title="Move up" onClick={() => moveField(index, -1)}>
                  ↑
                </button>
                <button className="icon-btn" title="Move down" onClick={() => moveField(index, 1)}>
                  ↓
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete column"
                  onClick={() => removeField(field.id)}
                >
                  ✕
                </button>
              </div>

              {field.type === 'symbols' && (
                <SymbolEditor
                  field={field}
                  onChange={(symbols) =>
                    setFields((fields) =>
                      fields.map((entry) => (entry.id === field.id ? { ...entry, symbols } : entry))
                    )
                  }
                />
              )}
            </div>
          ))}
        </div>
        <button className="btn" onClick={addField}>
          + Add column
        </button>
      </div>
    </div>
  )
}

export const partyModule = defineModule<State, Settings>({
  id: 'party',
  name: 'Party Tracker',
  icon: '🛡️',
  blurb: 'Your party, with columns you define yourself — AC, HP, passives, anything.',
  category: 'Tracking',
  defaultState: () => ({ fields: defaultPartyFields(), characters: [], columnWidths: {} }),
  defaultSettings: () => ({ compact: false, showPlayerColumn: true }),
  Component: Party,
  Settings: PartySettings
})
