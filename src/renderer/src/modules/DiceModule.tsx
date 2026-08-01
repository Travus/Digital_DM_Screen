import { uid } from '../../../shared/layout'
import { rollExpression, type RollResult } from '../lib/dice'
import { defineModule, type ModuleProps } from './types'

interface HistoryEntry extends RollResult {
  id: string
  label?: string
}

interface State {
  expression: string
  invalid: boolean
  history: HistoryEntry[]
}

interface Settings {
  quickDice: string
  historyLimit: number
  showBreakdown: boolean
}

function Dice({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  const quick = settings.quickDice
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  const roll = (expression: string, label?: string): void => {
    const result = rollExpression(expression)
    if (!result) {
      setState({ invalid: true })
      return
    }
    setState((prev) => ({
      invalid: false,
      history: [{ ...result, id: uid('roll'), label }, ...prev.history].slice(0, settings.historyLimit)
    }))
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <input
          className={`input grow ${state.invalid ? 'invalid' : ''}`}
          placeholder="2d6+3, 4d6kh3, d20…"
          value={state.expression}
          onChange={(event) => setState({ expression: event.target.value, invalid: false })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') roll(state.expression)
          }}
        />
        <button className="btn primary" onClick={() => roll(state.expression)}>
          Roll
        </button>
      </div>

      {state.invalid && (
        <p className="note warn">
          Couldn’t read that. Try <code>2d6+3</code>, <code>4d6dl1</code>, or <code>250d20</code>.
        </p>
      )}

      <div className="chip-row">
        {quick.map((expression) => (
          <button key={expression} className="chip action" onClick={() => roll(expression)}>
            {expression}
          </button>
        ))}
        <button className="chip action" onClick={() => roll('2d20kh1', 'advantage')}>
          adv
        </button>
        <button className="chip action" onClick={() => roll('2d20kl1', 'disadvantage')}>
          dis
        </button>
      </div>

      <div className="stack tight">
        {state.history.map((entry, index) => (
          <div key={entry.id} className={`roll ${index === 0 ? 'latest' : ''}`}>
            <span className="roll-total">{entry.total}</span>
            <div className="roll-body">
              <span className="roll-expr">
                {entry.expression}
                {entry.label ? ` · ${entry.label}` : ''}
              </span>
              {settings.showBreakdown && <span className="roll-detail">{entry.breakdown}</span>}
            </div>
          </div>
        ))}
      </div>

      {state.history.length > 0 && (
        <button className="btn" onClick={() => setState({ history: [] })}>
          Clear history
        </button>
      )}
    </div>
  )
}

function DiceSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  return (
    <div className="stack tight">
      <label className="field">
        <span>Quick-roll buttons (comma separated)</span>
        <input
          className="input"
          value={settings.quickDice}
          onChange={(event) => setSettings({ quickDice: event.target.value })}
        />
      </label>
      <label className="field">
        <span>History length — {settings.historyLimit}</span>
        <input
          type="range"
          min={5}
          max={100}
          step={5}
          value={settings.historyLimit}
          onChange={(event) => setSettings({ historyLimit: Number(event.target.value) })}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.showBreakdown}
          onChange={(event) => setSettings({ showBreakdown: event.target.checked })}
        />
        Show individual die results
      </label>
      <p className="note">
        Supports <code>NdM</code> and flat modifiers, combined freely —{' '}
        <code>2d6 + 1d4 - 1</code>. Also <code>kh</code>/<code>kl</code> to keep the highest or
        lowest dice and <code>dh</code>/<code>dl</code> to drop them: <code>4d6dl1</code> and{' '}
        <code>4d6kh3</code> are the same roll. Up to 1000 dice at a time.
      </p>
    </div>
  )
}

export const diceModule = defineModule<State, Settings>({
  id: 'dice',
  name: 'Dice Roller',
  icon: '🎲',
  blurb: 'Roll arbitrary expressions with a running history.',
  category: 'Tools',
  defaultState: () => ({ expression: '1d20', invalid: false, history: [] }),
  defaultSettings: () => ({
    quickDice: 'd4, d6, d8, d10, d12, d20, d100',
    historyLimit: 25,
    showBreakdown: true
  }),
  Component: Dice,
  Settings: DiceSettings
})
