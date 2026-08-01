import { useAppStore } from '../state/store'

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString()
}

export function RecentsPanel(): JSX.Element {
  const recents = useAppStore((state) => state.recents)
  const currentPath = useAppStore((state) => state.filePath)
  const openLayout = useAppStore((state) => state.openLayout)
  const removeRecent = useAppStore((state) => state.removeRecent)
  const clearRecents = useAppStore((state) => state.clearRecents)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h2>Recent layouts</h2>
        <button className="icon-btn" title="Close" onClick={toggleSidebar}>
          ✕
        </button>
      </div>

      {recents.length === 0 ? (
        <p className="empty">
          Layouts you save or open show up here. They are stored per file, so a layout you share with
          a friend carries every panel and its contents with it.
        </p>
      ) : (
        <ul className="recent-list">
          {recents.map((entry) => (
            <li key={entry.path} className={entry.path === currentPath ? 'current' : ''}>
              <button className="recent-main" onClick={() => void openLayout(entry.path)}>
                <span className="recent-name">{entry.name}</span>
                <span className="recent-path" title={entry.path}>
                  {entry.path}
                </span>
                <span className="recent-time">{relativeTime(entry.openedAt)}</span>
              </button>
              <button
                className="icon-btn danger"
                title="Remove from this list"
                onClick={() => void removeRecent(entry.path)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {recents.length > 0 && (
        <button className="btn" onClick={() => void clearRecents()}>
          Clear list
        </button>
      )}
    </aside>
  )
}
