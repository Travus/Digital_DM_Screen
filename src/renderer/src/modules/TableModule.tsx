import { useLayoutEffect, useRef, useState } from 'react'
import { uid } from '../../../shared/layout'
import { MarkupText } from '../components/MarkupText'
import { useMarkupKeys } from '../components/markupKeys'
import {
  parseGrid,
  rangeContains,
  rangeOf,
  rangeSize,
  toTsv,
  type CellRange,
  type CellRef
} from '../lib/grid'
import { hasMarkup } from '../lib/markup'
import { defineModule, type ModuleProps } from './types'

type Align = 'left' | 'center' | 'right'

interface TableColumn {
  id: string
  label: string
  width: number
  align: Align
}

interface TableRow {
  id: string
  /** Keyed by column id, so deleting a column cannot shift a row's values. */
  cells: Record<string, string>
}

interface State {
  columns: TableColumn[]
  rows: TableRow[]
}

interface Settings {
  headerRow: boolean
  shadedRows: boolean
  compact: boolean
}

const MIN_COLUMN = 46
const MAX_COLUMN = 640
const DEFAULT_WIDTH = 160
const ACTIONS_WIDTH = 44

/**
 * Ids are literal, not generated: `defaultState` builds the merge base for
 * sparse panel state, so minting fresh ids each call would strand anything that
 * had already persisted one.
 *
 * The starter grid is empty on purpose. A random table ships with content
 * because its content is the useful part; a blank data table is the useful part
 * here, and invented rows would be three deletions before anyone starts.
 */
function starterColumns(): TableColumn[] {
  return [
    { id: 'col_a', label: 'Name', width: DEFAULT_WIDTH, align: 'left' },
    { id: 'col_b', label: 'Value', width: 110, align: 'left' },
    { id: 'col_c', label: 'Notes', width: 220, align: 'left' }
  ]
}

function starterRows(): TableRow[] {
  return [
    { id: 'row_1', cells: {} },
    { id: 'row_2', cells: {} },
    { id: 'row_3', cells: {} }
  ]
}

const ALIGN_ORDER: Align[] = ['left', 'center', 'right']
const ALIGN_GLYPH: Record<Align, string> = { left: '⇤', center: '↔', right: '⇥' }
const ALIGN_LABEL: Record<Align, string> = { left: 'Left', center: 'Centre', right: 'Right' }

function newColumn(index: number): TableColumn {
  return { id: uid('col'), label: `Column ${index + 1}`, width: DEFAULT_WIDTH, align: 'left' }
}

/** Where a cell input lives, so keyboard navigation can find the next one. */
function cellKey(row: number, column: number): string {
  return `${row}:${column}`
}

const ARROW_STEP: Record<string, CellRef | undefined> = {
  ArrowUp: { row: -1, column: 0 },
  ArrowDown: { row: 1, column: 0 },
  ArrowLeft: { row: 0, column: -1 },
  ArrowRight: { row: 0, column: 1 }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function Table({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const resizeRef = useRef<{ id: string; startX: number; startWidth: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const handleMarkupKeys = useMarkupKeys()

  /**
   * The cell to focus once React has committed.
   *
   * Enter and Tab may both land on a row that does not exist yet, and the input
   * cannot be focused until the render that creates it. Going through a ref for
   * the ordinary case too keeps one path rather than two that could drift.
   */
  const pendingFocus = useRef<string | null>(null)

  useLayoutEffect(() => {
    const key = pendingFocus.current
    if (!key) return
    const input = wrapRef.current?.querySelector<HTMLInputElement>(`[data-cell="${key}"]`)
    // Left standing when the cell is not there yet. Adding a row and moving the
    // selection are two updates, and nothing guarantees they land in one render
    // — clearing the request on the first would drop the focus on the floor.
    if (!input) return
    pendingFocus.current = null
    input.focus()
    // Selected, not just focused, so typing replaces the cell the way a
    // spreadsheet does.
    input.select()
  })

  /**
   * The selected rectangle, and whether a drag is currently drawing it. Neither
   * is persisted — a selection is where you are right now, not part of the
   * layout, and reloading a `.dmscreen` with one restored would be noise.
   */
  const [selection, setSelection] = useState<{ anchor: CellRef; focus: CellRef } | null>(null)
  const draggingRef = useRef(false)

  const range: CellRange | null = selection ? rangeOf(selection.anchor, selection.focus) : null
  /** One cell is just a caret. The clipboard is only taken over for a real block. */
  const blockSelected = range !== null && rangeSize(range) > 1

  const cellValue = (row: TableRow, columnId: string): string => row.cells[columnId] ?? ''

  const setCell = (rowId: string, columnId: string, value: string): void =>
    setState((prev) => ({
      rows: prev.rows.map((row) =>
        row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row
      )
    }))

  const addRow = (): void =>
    setState((prev) => ({ rows: [...prev.rows, { id: uid('row'), cells: {} }] }))

  const addColumn = (): void =>
    setState((prev) => ({ columns: [...prev.columns, newColumn(prev.columns.length)] }))

  const removeRow = (rowId: string): void => {
    setSelection(null)
    setState((prev) => ({ rows: prev.rows.filter((row) => row.id !== rowId) }))
  }

  const beginResize = (
    id: string,
    width: number,
    event: React.PointerEvent<HTMLSpanElement>
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    resizeRef.current = { id, startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onResize = (event: React.PointerEvent<HTMLSpanElement>): void => {
    const drag = resizeRef.current
    if (!drag) return
    const width = Math.round(
      Math.max(MIN_COLUMN, Math.min(MAX_COLUMN, drag.startWidth + (event.clientX - drag.startX)))
    )
    setState((prev) => ({
      columns: prev.columns.map((column) => (column.id === drag.id ? { ...column, width } : column))
    }))
  }

  const endResize = (event: React.PointerEvent<HTMLSpanElement>): void => {
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  /**
   * A plain click puts the caret in one cell; dragging across cells, or
   * shift-clicking, draws a block. Extension happens on *entering another* cell,
   * so selecting text inside a single cell still behaves normally.
   */
  const startSelect = (row: number, column: number, event: React.PointerEvent): void => {
    draggingRef.current = true
    if (event.shiftKey && selection) {
      setSelection({ anchor: selection.anchor, focus: { row, column } })
      return
    }
    setSelection({ anchor: { row, column }, focus: { row, column } })
  }

  const extendSelect = (row: number, column: number): void => {
    if (!draggingRef.current) return
    setSelection((prev) => (prev ? { anchor: prev.anchor, focus: { row, column } } : prev))
  }

  const selectedCells = (block: CellRange): string[][] =>
    state.rows
      .slice(block.top, block.bottom + 1)
      .map((row) =>
        state.columns.slice(block.left, block.right + 1).map((column) => cellValue(row, column.id))
      )

  const onCopy = (event: React.ClipboardEvent): void => {
    if (!range || !blockSelected) return
    event.preventDefault()
    event.clipboardData.setData('text/plain', toTsv(selectedCells(range)))
  }

  const clearRange = (block: CellRange): void =>
    setState((prev) => ({
      rows: prev.rows.map((row, rowIndex) => {
        if (rowIndex < block.top || rowIndex > block.bottom) return row
        const cells = { ...row.cells }
        for (const column of prev.columns.slice(block.left, block.right + 1)) {
          delete cells[column.id]
        }
        return { ...row, cells }
      })
    }))

  const onCut = (event: React.ClipboardEvent): void => {
    if (!range || !blockSelected) return
    onCopy(event)
    clearRange(range)
  }

  /**
   * Pasting grows the table to fit rather than clipping, because the row and
   * column counts of a block copied from a spreadsheet are the shape the DM
   * meant, and silently dropping the overhang loses data with no sign it
   * happened.
   */
  const onPaste = (event: React.ClipboardEvent): void => {
    const text = event.clipboardData.getData('text/plain')
    const grid = parseGrid(text)
    // A single cell with no structure is an ordinary paste; leave it to the input.
    if (grid.length === 0 || (grid.length === 1 && grid[0].length <= 1)) return

    event.preventDefault()
    const target = range ?? { top: 0, left: 0, bottom: 0, right: 0 }

    setState((prev) => {
      const width = target.left + grid[0].length
      const columns = [...prev.columns]
      while (columns.length < width) columns.push(newColumn(columns.length))

      const rows = [...prev.rows]
      while (rows.length < target.top + grid.length) rows.push({ id: uid('row'), cells: {} })

      const next = rows.map((row, rowIndex) => {
        const source = grid[rowIndex - target.top]
        if (!source) return row
        const cells = { ...row.cells }
        source.forEach((value, offset) => {
          const column = columns[target.left + offset]
          if (column) cells[column.id] = value
        })
        return { ...row, cells }
      })

      return { columns, rows: next }
    })

    setSelection({
      anchor: { row: target.top, column: target.left },
      focus: {
        row: target.top + grid.length - 1,
        column: target.left + grid[0].length - 1
      }
    })
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // Only a block claims these keys — inside one cell they are ordinary editing.
    if (!range || !blockSelected) return
    if (event.key !== 'Delete' && event.key !== 'Backspace') return
    event.preventDefault()
    clearRange(range)
  }

  /**
   * Move the caret to another cell, adding a row if the move runs off the
   * bottom. Both keys grow the table rather than stopping dead: the last cell is
   * where a table is always being extended from, and a key that simply does
   * nothing there reads as broken.
   */
  const focusCell = (row: number, column: number): void => {
    pendingFocus.current = cellKey(row, column)
    // Collapse the block to wherever the caret went, so the highlight follows.
    setSelection({ anchor: { row, column }, focus: { row, column } })
    if (row >= state.rows.length) addRow()
  }

  /**
   * Enter steps down a column, Tab across a row and on to the next.
   *
   * Tab is intercepted because the row's remove button sits between the last
   * cell of one row and the first of the next in DOM order. It is taken out of
   * the tab ring as well (`tabIndex={-1}`), so Shift+Tab is left to the browser
   * and still walks back through cells only.
   */
  const onCellKeyDown = (event: React.KeyboardEvent, row: number, column: number): void => {
    // Shift+arrow grows a block from the cell the caret is in. Dragging is the
    // obvious way to select one, and was for a while the only way — which put
    // copying a column out of reach of anyone not using a mouse.
    const step = event.shiftKey ? ARROW_STEP[event.key] : undefined
    if (step) {
      event.preventDefault()
      setSelection((prev) => {
        const anchor = prev?.anchor ?? { row, column }
        const from = prev?.focus ?? { row, column }
        return {
          anchor,
          focus: {
            row: clamp(from.row + step.row, 0, state.rows.length - 1),
            column: clamp(from.column + step.column, 0, state.columns.length - 1)
          }
        }
      })
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      focusCell(row + 1, column)
      return
    }

    if (event.key !== 'Tab' || event.shiftKey) return
    event.preventDefault()
    const last = column === state.columns.length - 1
    focusCell(last ? row + 1 : row, last ? 0 : column + 1)
  }

  const tableWidth = state.columns.reduce((sum, column) => sum + column.width, ACTIONS_WIDTH)

  return (
    <div className={`stack ${settings.compact ? 'compact' : ''}`}>
      <div
        ref={wrapRef}
        className="table-wrap"
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onPointerUp={() => {
          draggingRef.current = false
        }}
        onPointerLeave={() => {
          draggingRef.current = false
        }}
      >
        <table
          className={`table grid resizable data-table ${settings.shadedRows ? 'shaded' : ''}`}
          style={{ minWidth: tableWidth }}
        >
          <colgroup>
            {state.columns.map((column) => (
              <col key={column.id} style={{ width: column.width }} />
            ))}
            {/* Soaks up any extra width so the actions column stays at the edge. */}
            <col />
            <col style={{ width: ACTIONS_WIDTH }} />
          </colgroup>

          {settings.headerRow && (
            <thead>
              <tr>
                {state.columns.map((column) => (
                  <th key={column.id} style={{ textAlign: column.align }}>
                    <input
                      className="cell-input th-input"
                      style={{ textAlign: column.align }}
                      value={column.label}
                      placeholder="Column"
                      onChange={(event) =>
                        setState((prev) => ({
                          columns: prev.columns.map((entry) =>
                            entry.id === column.id ? { ...entry, label: event.target.value } : entry
                          )
                        }))
                      }
                    />
                    <span
                      className="col-resize"
                      title="Drag to resize · double-click to reset"
                      onPointerDown={(event) => beginResize(column.id, column.width, event)}
                      onPointerMove={onResize}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                      onDoubleClick={() =>
                        setState((prev) => ({
                          columns: prev.columns.map((entry) =>
                            entry.id === column.id ? { ...entry, width: DEFAULT_WIDTH } : entry
                          )
                        }))
                      }
                    />
                  </th>
                ))}
                <th />
                <th className="col-actions" />
              </tr>
            </thead>
          )}

          <tbody>
            {state.rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {state.columns.map((column, columnIndex) => {
                  const value = cellValue(row, column.id)
                  const inBlock = range !== null && rangeContains(range, rowIndex, columnIndex)
                  return (
                    <td
                      key={column.id}
                      className={inBlock && blockSelected ? 'cell-picked' : undefined}
                      onPointerDown={(event) => startSelect(rowIndex, columnIndex, event)}
                      onPointerEnter={() => extendSelect(rowIndex, columnIndex)}
                    >
                      <span className={`cell-markup ${hasMarkup(value) ? 'rich' : ''}`}>
                        <input
                          className="cell-input"
                          style={{ textAlign: column.align }}
                          data-cell={cellKey(rowIndex, columnIndex)}
                          value={value}
                          onChange={(event) => setCell(row.id, column.id, event.target.value)}
                          onKeyDown={(event) => {
                            handleMarkupKeys(event, value, (next) =>
                              setCell(row.id, column.id, next)
                            )
                            onCellKeyDown(event, rowIndex, columnIndex)
                          }}
                        />
                        {/* Shown whenever the cell is not focused, so the table
                            reads as formatted and the markers only surface in the
                            one cell being edited. */}
                        {hasMarkup(value) && (
                          <span
                            className="cell-render"
                            style={{ textAlign: column.align }}
                            aria-hidden="true"
                          >
                            <MarkupText text={value} />
                          </span>
                        )}
                      </span>
                    </td>
                  )
                })}

                <td />
                <td className="col-actions">
                  {/* Out of the tab ring: it sits between the last cell of one
                      row and the first of the next, and Tab is for cells. */}
                  <button
                    className="icon-btn danger"
                    title="Remove row"
                    tabIndex={-1}
                    onClick={() => removeRow(row.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.rows.length === 0 && <p className="empty">No rows yet — add one below.</p>}

      <div className="toolbar">
        <button className="btn primary" onClick={addRow}>
          + Row
        </button>
        <button className="btn" onClick={addColumn}>
          + Column
        </button>
        <span className="spacer" />
        <span className="note">
          Ctrl+B bold · Ctrl+I italic · Tab and Enter move between cells · drag or Shift+arrows to
          select a block, then copy or paste
        </span>
      </div>
    </div>
  )
}

function TableSettings({
  state,
  setState,
  settings,
  setSettings
}: ModuleProps<State, Settings>): JSX.Element {
  const cycleAlign = (columnId: string): void =>
    setState((prev) => ({
      columns: prev.columns.map((column) =>
        column.id === columnId
          ? {
              ...column,
              align: ALIGN_ORDER[(ALIGN_ORDER.indexOf(column.align) + 1) % ALIGN_ORDER.length]
            }
          : column
      )
    }))

  return (
    <div className="stack tight">
      <label className="check">
        <input
          type="checkbox"
          checked={settings.headerRow}
          onChange={(event) => setSettings({ headerRow: event.target.checked })}
        />
        Header row
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.shadedRows}
          onChange={(event) => setSettings({ shadedRows: event.target.checked })}
        />
        Shade alternate rows
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.compact}
          onChange={(event) => setSettings({ compact: event.target.checked })}
        />
        Compact rows
      </label>

      {/* Columns are configured here as well as in the header, because turning
          the header row off would otherwise take the only way to rename a
          column, realign it or delete it. */}
      <h4 className="section-title">Columns</h4>
      {state.columns.map((column) => (
        <div key={column.id} className="field-row">
          <input
            className="input grow"
            value={column.label}
            placeholder="Column"
            onChange={(event) =>
              setState((prev) => ({
                columns: prev.columns.map((entry) =>
                  entry.id === column.id ? { ...entry, label: event.target.value } : entry
                )
              }))
            }
          />
          <button
            className="icon-btn"
            title={`Align: ${ALIGN_LABEL[column.align]}`}
            onClick={() => cycleAlign(column.id)}
          >
            {ALIGN_GLYPH[column.align]}
          </button>
          <button
            className="icon-btn danger"
            title="Remove column"
            onClick={() =>
              setState((prev) => ({
                columns: prev.columns.filter((entry) => entry.id !== column.id)
              }))
            }
          >
            ✕
          </button>
        </div>
      ))}
      {state.columns.length === 0 && <p className="empty">No columns — add one in the panel.</p>}
    </div>
  )
}

export const tableModule = defineModule<State, Settings>({
  id: 'table',
  name: 'Table',
  icon: '▦',
  blurb: 'A plain data table — shop stock, travel times, whatever needs rows and columns.',
  category: 'Tools',
  defaultState: () => ({ columns: starterColumns(), rows: starterRows() }),
  defaultSettings: () => ({ headerRow: true, shadedRows: true, compact: false }),
  Component: Table,
  Settings: TableSettings
})
