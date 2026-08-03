import { useState } from 'react'
import { useAppStore } from '../state/store'
import { primaryModifier } from '../lib/platform'

export function TopBar(): JSX.Element {
  const name = useAppStore((state) => state.doc.name)
  const dirty = useAppStore((state) => state.dirty)
  const filePath = useAppStore((state) => state.filePath)
  const theme = useAppStore((state) => state.theme)
  const locked = useAppStore((state) => state.doc.locked)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)

  const newLayout = useAppStore((state) => state.newLayout)
  const openLayout = useAppStore((state) => state.openLayout)
  const save = useAppStore((state) => state.save)
  const saveAs = useAppStore((state) => state.saveAs)
  const renameLayout = useAppStore((state) => state.renameLayout)
  const setTheme = useAppStore((state) => state.setTheme)
  const toggleLock = useAppStore((state) => state.toggleLock)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)

  const [renaming, setRenaming] = useState(false)

  return (
    <header className="topbar">
      <div className="brand" title="Digital DM Screen">
        {/* Inline rather than a glyph — no font dependency to go missing. */}
        <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2 3.5 5v7.2c0 5.2 3.6 8.9 8.5 9.8 4.9-.9 8.5-4.6 8.5-9.8V5L12 2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M12 7v9M8 11h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>

      {renaming ? (
        <input
          className="layout-name-input"
          autoFocus
          defaultValue={name}
          onBlur={(event) => {
            const next = event.target.value.trim()
            if (next) renameLayout(next)
            setRenaming(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') setRenaming(false)
          }}
        />
      ) : (
        <button
          className="layout-name"
          title={filePath ?? 'Not saved to a file yet — click to rename'}
          onClick={() => setRenaming(true)}
        >
          {name}
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </button>
      )}

      <span className="spacer" />

      <div className="topbar-actions">
        <button
          className="btn"
          onClick={() => void newLayout()}
          title={`New layout (${primaryModifier}+N)`}
        >
          New
        </button>
        <button
          className="btn"
          onClick={() => void openLayout()}
          title={`Open layout (${primaryModifier}+O)`}
        >
          Open
        </button>
        <button
          className="btn primary"
          onClick={() => void save()}
          title={`Save layout (${primaryModifier}+S)`}
        >
          Save
        </button>
        <button
          className="btn"
          onClick={() => void saveAs()}
          title={`Save as… (${primaryModifier}+Shift+S)`}
        >
          Save As
        </button>

        <span className="divider" />

        <button
          className={`icon-btn ${locked ? 'on' : ''}`}
          onClick={toggleLock}
          title={
            locked
              ? 'Layout locked — click to allow resizing, splitting and closing panels'
              : 'Lock the layout: freeze panel sizes and positions'
          }
        >
          <LockIcon locked={locked} />
        </button>

        <button
          className={`btn ${sidebarOpen ? 'primary' : ''}`}
          onClick={toggleSidebar}
          title="Recent layouts"
        >
          Recent
        </button>
        <button
          className="icon-btn"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}

/** Inline so it matches the brand mark and needs no icon font. */
function LockIcon({ locked }: { locked: boolean }): JSX.Element {
  return (
    <svg className="lock-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect
        x="5"
        y="10.5"
        width="14"
        height="9.5"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      {/* Open shackle swings clear of the body when unlocked. */}
      <path
        d={locked ? 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3' : 'M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}
