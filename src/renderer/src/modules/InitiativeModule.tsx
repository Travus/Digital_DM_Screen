import { useState } from 'react'
import { uid } from '../../../shared/layout'
import { NumberInput } from '../components/NumberInput'
import { CONDITION_NAMES } from '../data/conditions'
import { rollDie } from '../lib/dice'
import {
  applyStatToParty,
  findAcField,
  findHpField,
  isPartyPanel,
  readLinkedStats,
  type LinkedStats,
  type PartyLink
} from '../lib/partyLink'
import { useAppStore } from '../state/store'
import type { PartyCharacter } from './PartyModule'
import { defineModule, type ModuleProps } from './types'

interface Combatant {
  id: string
  name: string
  initiative: number
  ac: number
  hpCurrent: number
  hpMax: number
  conditions: string[]
  note: string
  isPlayer: boolean
  /** Set when this combatant was imported from a Party Tracker panel. */
  partyLink?: PartyLink
}

interface State {
  combatants: Combatant[]
  round: number
  turnIndex: number
}

interface Settings {
  showAc: boolean
  showNotes: boolean
  hideEnemyHp: boolean
  /** Mirror AC and HP to and from the party panel a combatant was imported from. */
  syncParty: boolean
}

function makeCombatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: uid('c'),
    name: '',
    initiative: 0,
    ac: 10,
    hpCurrent: 0,
    hpMax: 0,
    conditions: [],
    note: '',
    isPlayer: false,
    ...overrides
  }
}

/**
 * Pulls characters out of every Party Tracker panel in the current layout,
 * remembering where each one came from so its stats can stay linked.
 *
 * Read on demand via getState() rather than subscribed, so typing in a party
 * panel doesn't re-run this.
 */
function collectPartyMembers(): Combatant[] {
  const { doc } = useAppStore.getState()
  const members: Combatant[] = []

  for (const [panelId, panel] of Object.entries(doc.panels)) {
    if (!isPartyPanel(panel)) continue
    const characters = (panel.state.characters as PartyCharacter[] | undefined) ?? []
    const acField = findAcField(panel)
    const hpField = findHpField(panel)

    for (const character of characters) {
      if (!character.name.trim()) continue
      const hp = hpField
        ? (character.values[hpField.id] as { current?: number; max?: number } | undefined)
        : undefined
      members.push(
        makeCombatant({
          name: character.name,
          isPlayer: true,
          partyLink: { panelId, characterId: character.id },
          ac: acField ? Number(character.values[acField.id]) || 10 : 10,
          hpCurrent: typeof hp?.current === 'number' ? hp.current : 0,
          hpMax: typeof hp?.max === 'number' ? hp.max : 0
        })
      )
    }
  }

  return members
}

const NO_LINKS: Record<string, LinkedStats> = {}

function Initiative({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  /**
   * Live AC/HP for every linked combatant. The custom equality keeps this from
   * re-rendering the panel on unrelated document changes — otherwise every
   * keystroke anywhere in the layout would redraw the initiative order.
   */
  const linkedStats = useAppStore(
    (store) => {
      if (!settings.syncParty) return NO_LINKS
      const found: Record<string, LinkedStats> = {}
      for (const combatant of state.combatants) {
        const stats = readLinkedStats(store.doc.panels, combatant.partyLink)
        if (stats) found[combatant.id] = stats
      }
      return found
    },
    (a, b) => JSON.stringify(a) === JSON.stringify(b)
  )

  const setCombatants = (updater: (combatants: Combatant[]) => Combatant[]): void =>
    setState((prev) => ({ combatants: updater(prev.combatants) }))

  const patch = (id: string, changes: Partial<Combatant>): void => {
    const combatant = state.combatants.find((entry) => entry.id === id)

    // Push stat edits back to the party panel first, so the two never disagree
    // even for a frame.
    if (settings.syncParty && combatant?.partyLink) {
      const { ac, hpCurrent, hpMax } = changes
      if (ac !== undefined || hpCurrent !== undefined || hpMax !== undefined) {
        const store = useAppStore.getState()
        const characters = applyStatToParty(store.doc.panels, combatant.partyLink, {
          ac,
          hpCurrent,
          hpMax
        })
        if (characters) store.updatePanelState(combatant.partyLink.panelId, { characters })
      }
    }

    setCombatants((combatants) =>
      combatants.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry))
    )
  }

  const advance = (delta: number): void =>
    setState((prev) => {
      if (prev.combatants.length === 0) return prev
      const next = prev.turnIndex + delta
      if (next >= prev.combatants.length) return { turnIndex: 0, round: prev.round + 1 }
      if (next < 0) {
        return { turnIndex: prev.combatants.length - 1, round: Math.max(1, prev.round - 1) }
      }
      return { turnIndex: next }
    })

  const sortByInitiative = (): void =>
    setState((prev) => {
      const active = prev.combatants[prev.turnIndex]
      const sorted = [...prev.combatants].sort((a, b) => b.initiative - a.initiative)
      // Keep the spotlight on whoever's turn it actually is after reordering.
      const turnIndex = active ? Math.max(0, sorted.findIndex((entry) => entry.id === active.id)) : 0
      return { combatants: sorted, turnIndex }
    })

  const rollAllInitiative = (): void =>
    setCombatants((combatants) =>
      combatants.map((combatant) =>
        combatant.isPlayer ? combatant : { ...combatant, initiative: rollDie(20) }
      )
    )

  const importParty = (): void => {
    const members = collectPartyMembers()
    if (members.length === 0) return
    setCombatants((combatants) => {
      const taken = new Set(combatants.map((entry) => entry.name.trim().toLowerCase()))
      return [...combatants, ...members.filter((member) => !taken.has(member.name.trim().toLowerCase()))]
    })
  }

  const move = (index: number, delta: number): void =>
    setCombatants((combatants) => {
      const target = index + delta
      if (target < 0 || target >= combatants.length) return combatants
      const next = [...combatants]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })

  return (
    <div className="stack">
      <div className="toolbar wrap">
        <div className="round-pill">
          <span className="round-label">Round</span>
          <span className="round-value">{state.round}</span>
        </div>
        <button className="btn primary" onClick={() => advance(1)} disabled={!state.combatants.length}>
          Next turn ▸
        </button>
        <button className="btn" onClick={() => advance(-1)} disabled={!state.combatants.length}>
          ◂ Back
        </button>
        <span className="spacer" />
        <button className="btn" onClick={sortByInitiative}>
          Sort
        </button>
        <button className="btn" onClick={rollAllInitiative} title="Roll d20 initiative for non-player combatants">
          Roll NPCs
        </button>
        <button className="btn" onClick={importParty} title="Add every named character from Party Tracker panels">
          + Party
        </button>
        <button className="btn" onClick={() => setState({ round: 1, turnIndex: 0 })} title="Back to round 1">
          Reset
        </button>
      </div>

      <div className="stack tight">
        {state.combatants.map((combatant, index) => (
          <CombatantRow
            key={combatant.id}
            combatant={combatant}
            linked={linkedStats[combatant.id]}
            active={index === state.turnIndex}
            settings={settings}
            onPatch={(changes) => patch(combatant.id, changes)}
            onMove={(delta) => move(index, delta)}
            onRemove={() =>
              setState((prev) => ({
                combatants: prev.combatants.filter((entry) => entry.id !== combatant.id),
                turnIndex: Math.max(0, Math.min(prev.turnIndex, prev.combatants.length - 2))
              }))
            }
          />
        ))}
      </div>

      {state.combatants.length === 0 && <p className="empty">Nothing in the initiative order yet.</p>}

      <div className="toolbar">
        <button className="btn primary" onClick={() => setCombatants((list) => [...list, makeCombatant()])}>
          + Add combatant
        </button>
        <button
          className="btn"
          onClick={() => setState({ combatants: [], round: 1, turnIndex: 0 })}
          disabled={!state.combatants.length}
        >
          Clear all
        </button>
      </div>
    </div>
  )
}

function CombatantRow({
  combatant,
  linked,
  active,
  settings,
  onPatch,
  onMove,
  onRemove
}: {
  combatant: Combatant
  linked: LinkedStats | undefined
  active: boolean
  settings: Settings
  onPatch: (changes: Partial<Combatant>) => void
  onMove: (delta: number) => void
  onRemove: () => void
}): JSX.Element {
  const [delta, setDelta] = useState('')

  // The party panel wins for any column it actually provides.
  const ac = linked?.ac ?? combatant.ac
  const hpCurrent = linked?.hpCurrent ?? combatant.hpCurrent
  const hpMax = linked?.hpMax ?? combatant.hpMax

  /**
   * Applies the ± box. `sign` is the explicit direction from the − / + buttons;
   * pressing Enter passes null and the prefix decides: "+5" heals, "-4" damages,
   * and a bare "9" damages, that being what you type most of the time.
   */
  const applyDelta = (sign: 1 | -1 | null): void => {
    const raw = delta.trim()
    const amount = Math.abs(Number(raw))
    if (!raw || !Number.isFinite(amount) || amount === 0) return

    const direction = sign ?? (raw.startsWith('+') ? 1 : -1)
    // Hit points stop at 0 — you don't track how far past dead someone is here.
    onPatch({ hpCurrent: Math.max(0, hpCurrent + direction * amount) })
    setDelta('')
  }

  const hpHidden = settings.hideEnemyHp && !combatant.isPlayer
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, (hpCurrent / hpMax) * 100)) : 0
  const tone = hpCurrent <= 0 ? 'out' : pct <= 25 ? 'low' : pct <= 50 ? 'mid' : 'ok'

  return (
    <div className={`combatant ${active ? 'active' : ''} ${combatant.isPlayer ? 'pc' : 'npc'}`}>
      <div className="combatant-main">
        <NumberInput
          className="init-input"
          title="Initiative"
          value={combatant.initiative}
          onChange={(initiative) => onPatch({ initiative })}
        />
        <button
          className="icon-btn"
          title="Roll d20 for this combatant"
          onClick={() => onPatch({ initiative: rollDie(20) })}
        >
          <span className="emoji">🎲</span>
        </button>

        <input
          className="cell-input strong grow"
          placeholder="Name"
          value={combatant.name}
          onChange={(event) => onPatch({ name: event.target.value })}
        />

        {linked && (
          <span className="link-badge" title="AC and HP are shared with the Party Tracker">
            ⇄
          </span>
        )}

        <label className="check tiny" title="Mark as a player character">
          <input
            type="checkbox"
            checked={combatant.isPlayer}
            onChange={(event) => onPatch({ isPlayer: event.target.checked })}
          />
          PC
        </label>

        {settings.showAc && (
          <label className="mini-field" title="Armour Class">
            <span>AC</span>
            <NumberInput className="cell-input num" value={ac} onChange={(next) => onPatch({ ac: next })} />
          </label>
        )}

        <div className="hp-block">
          {hpHidden ? (
            <span className="hp-hidden" title="Hidden by this panel’s settings">
              {tone === 'out' ? 'down' : 'hp hidden'}
            </span>
          ) : (
            <>
              <NumberInput
                className="cell-input num"
                title="Current HP"
                value={hpCurrent}
                onChange={(next) => onPatch({ hpCurrent: next })}
              />
              <span className="slash">/</span>
              <NumberInput
                className="cell-input num"
                title="Max HP"
                value={hpMax}
                onChange={(next) => onPatch({ hpMax: next })}
              />
            </>
          )}
          <input
            className="cell-input num delta"
            placeholder="±"
            inputMode="numeric"
            title="Enter to apply: 9 or -9 damages, +9 heals. HP never drops below 0."
            value={delta}
            onChange={(event) => setDelta(event.target.value.replace(/[^\d+-]/g, ''))}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              applyDelta(null)
            }}
          />
          <button className="icon-btn danger" title="Apply as damage" onClick={() => applyDelta(-1)}>
            −
          </button>
          <button className="icon-btn good" title="Apply as healing" onClick={() => applyDelta(1)}>
            +
          </button>
        </div>

        <div className="row-actions">
          <button className="icon-btn" title="Move up" onClick={() => onMove(-1)}>
            ↑
          </button>
          <button className="icon-btn" title="Move down" onClick={() => onMove(1)}>
            ↓
          </button>
          <button className="icon-btn danger" title="Remove" onClick={onRemove}>
            ✕
          </button>
        </div>
      </div>

      {!hpHidden && hpMax > 0 && (
        <div className="meter-bar thin">
          <div className={`meter-fill ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="combatant-tags">
        {combatant.conditions.map((condition) => (
          <button
            key={condition}
            className="chip"
            title="Click to remove"
            onClick={() => onPatch({ conditions: combatant.conditions.filter((entry) => entry !== condition) })}
          >
            {condition} ✕
          </button>
        ))}
        <select
          className="chip-select"
          value=""
          onChange={(event) => {
            const value = event.target.value
            if (!value || combatant.conditions.includes(value)) return
            onPatch({ conditions: [...combatant.conditions, value] })
          }}
        >
          <option value="">+ condition</option>
          {CONDITION_NAMES.filter((name) => !combatant.conditions.includes(name)).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {settings.showNotes && (
          <input
            className="cell-input dim grow"
            placeholder="Notes — legendary actions, lair, concentration…"
            value={combatant.note}
            onChange={(event) => onPatch({ note: event.target.value })}
          />
        )}
      </div>
    </div>
  )
}

function InitiativeSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  return (
    <div className="stack tight">
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showAc}
          onChange={(event) => setSettings({ showAc: event.target.checked })}
        />
        Show AC
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showNotes}
          onChange={(event) => setSettings({ showNotes: event.target.checked })}
        />
        Show per-combatant notes
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.hideEnemyHp}
          onChange={(event) => setSettings({ hideEnemyHp: event.target.checked })}
        />
        Hide HP for non-player combatants
      </label>
      <p className="note">
        Handy if you ever share the screen: enemy hit points stay out of sight, but everything still
        tracks normally underneath.
      </p>

      <div className="settings-section">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.syncParty}
            onChange={(event) => setSettings({ syncParty: event.target.checked })}
          />
          Keep AC and HP in sync with the Party Tracker
        </label>
        <p className="note">
          Applies to combatants added with <strong>+ Party</strong>. Damage dealt here shows up in
          the party panel and vice versa. The party panel needs columns named exactly “AC” (number)
          and “HP” (meter); a missing column simply isn’t synced. Rows that are linked show a ⇄.
        </p>
      </div>
    </div>
  )
}

export const initiativeModule = defineModule<State, Settings>({
  id: 'initiative',
  name: 'Initiative Tracker',
  icon: '⚔️',
  blurb: 'Turn order, rounds, HP, and conditions. Can pull straight from a party panel.',
  category: 'Tracking',
  defaultState: () => ({ combatants: [], round: 1, turnIndex: 0 }),
  defaultSettings: () => ({ showAc: true, showNotes: true, hideEnemyHp: false, syncParty: true }),
  Component: Initiative,
  Settings: InitiativeSettings
})
