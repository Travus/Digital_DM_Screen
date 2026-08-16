import { MarkupTextarea } from '../components/MarkupTextarea'
import { stripMarkup } from '../lib/markup'
import { defineModule, type ModuleProps } from './types'

interface State {
  text: string
}

interface Settings {
  fontSize: number
  monospace: boolean
  spellcheck: boolean
}

function Notes({ state, setState, settings }: ModuleProps<State, Settings>): JSX.Element {
  // Count what the note says, not what marks it up: `**duke**` is one word.
  const plain = stripMarkup(state.text).trim()
  const words = plain ? plain.split(/\s+/).length : 0

  return (
    <div className="stack fill">
      <MarkupTextarea
        className={`notes-area ${settings.monospace ? 'mono' : ''}`}
        style={{ fontSize: `${settings.fontSize}px` }}
        spellCheck={settings.spellcheck}
        placeholder="Session notes, NPC names you just improvised, that plot thread you keep forgetting…"
        value={state.text}
        onChange={(text) => setState({ text })}
      />
      <div className="note right">Ctrl+B bold · Ctrl+I italic · {words} words</div>
    </div>
  )
}

function NotesSettings({ settings, setSettings }: ModuleProps<State, Settings>): JSX.Element {
  return (
    <div className="stack tight">
      <label className="field">
        <span>Font size — {settings.fontSize}px</span>
        <input
          type="range"
          min={11}
          max={24}
          value={settings.fontSize}
          onChange={(event) => setSettings({ fontSize: Number(event.target.value) })}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.monospace}
          onChange={(event) => setSettings({ monospace: event.target.checked })}
        />
        Monospace font
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.spellcheck}
          onChange={(event) => setSettings({ spellcheck: event.target.checked })}
        />
        Spell check
      </label>
    </div>
  )
}

export const notesModule = defineModule<State, Settings>({
  id: 'notes',
  name: 'Notes',
  icon: '📝',
  blurb: 'A scratchpad that travels with the layout.',
  category: 'Tools',
  defaultState: () => ({ text: '' }),
  defaultSettings: () => ({ fontSize: 14, monospace: false, spellcheck: true }),
  Component: Notes,
  Settings: NotesSettings
})
