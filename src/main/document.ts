/**
 * The layout document, held where it outlives any one window.
 *
 * It used to live in the renderer's store, with main mirroring the two fields
 * the close prompt needs. That is fine while there is exactly one renderer and
 * stops being fine the moment there are several: a document spanning several
 * windows has no renderer entitled to call itself the copy that gets written to
 * the file.
 *
 * So the document lives here and a renderer holds a view of it. Edits still
 * start in a renderer — `publish` is how one arrives — but what gets saved, what
 * the close prompt asks about and what the session stashes are all read from
 * here, from one copy, whatever is on screen.
 */
import { createEmptyDoc, parseLayoutDoc } from '../shared/layout'
import type { DocumentSnapshot, DocumentStatus, LayoutDoc, WindowBounds } from '../shared/types'
import { readSession, writeSession } from './userStore'
import { isUsableBounds } from './windowBounds'

/** How long the document must sit still before it is stashed in userData. */
const SESSION_DEBOUNCE_MS = 700

let doc: LayoutDoc = createEmptyDoc()
let filePath: string | null = null
let dirty = false
/**
 * Where each window last sat, by window id.
 *
 * Kept beside the document rather than in it: a layout describes a tiling, and
 * which monitor the players' screen is on is a fact about this desk. This rides
 * the session, so it never travels with a `.dmscreen`.
 */
let bounds: Record<string, WindowBounds> = {}

let sessionTimer: ReturnType<typeof setTimeout> | null = null
let announce: (status: DocumentStatus) => void = () => {}

export function current(): LayoutDoc {
  return doc
}

export function status(): DocumentStatus {
  return { filePath, dirty }
}

export function snapshot(): DocumentSnapshot {
  return { doc, filePath, dirty }
}

export function isDirty(): boolean {
  return dirty
}

export function name(): string {
  return doc.name
}

/**
 * Who to tell when the file path or the unsaved flag moves. Set once, by the
 * half of main that has windows to talk to — this module deliberately has none.
 */
export function onStatus(handler: (status: DocumentStatus) => void): void {
  announce = handler
}

function setStatus(nextPath: string | null, nextDirty: boolean): void {
  if (nextPath === filePath && nextDirty === dirty) return
  filePath = nextPath
  dirty = nextDirty
  announce(status())
}

export function rememberedBounds(): Record<string, WindowBounds> {
  return bounds
}

/** A window was moved or resized. Cheap, and debounced by the session write. */
export function rememberBounds(windowId: string, next: WindowBounds): void {
  bounds = { ...bounds, [windowId]: next }
  scheduleSession()
}

function scheduleSession(): void {
  if (sessionTimer) clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    sessionTimer = null
    void writeSession({ ...snapshot(), bounds })
  }, SESSION_DEBOUNCE_MS)
}

/**
 * Write the session now rather than when the timer says so.
 *
 * Every path that ends in the app going away calls this. On "Save and quit" the
 * process exits within milliseconds, so a pending debounce never fires and
 * `session.json` keeps the pre-save snapshot — including `dirty: true`. The
 * layout file was always written correctly there; the next launch simply
 * restored a stale flag and asked to save a document nothing had touched.
 */
export async function flushSession(): Promise<void> {
  if (sessionTimer) {
    clearTimeout(sessionTimer)
    sessionTimer = null
  }
  await writeSession({ ...snapshot(), bounds })
}

/**
 * Take an edit from a renderer.
 *
 * The renderer is authoritative for what the document *contains* — it is where
 * the tree operations and the module state live — so this adopts what it is
 * given rather than merging. What main adds is that the edit is now somewhere a
 * save can reach it without asking a window first.
 */
export function publish(next: LayoutDoc): void {
  doc = next
  setStatus(filePath, true)
  scheduleSession()
}

/** New, Open, and the session restore: a different document, cleanly. */
export function replace(next: LayoutDoc, path: string | null, nextDirty = false): void {
  doc = next
  // Geometry for windows this document does not have is dropped rather than
  // accumulated. Window ids are minted per document, so keeping them would grow
  // the session by a few entries per layout ever opened, and none of them would
  // ever match anything again.
  const live = new Set(next.windows.map((window) => window.id))
  bounds = Object.fromEntries(Object.entries(bounds).filter(([id]) => live.has(id)))
  setStatus(path, nextDirty)
  scheduleSession()
}

/** Written to disk, so the unsaved flag goes and the session records that. */
export async function markSaved(path: string): Promise<void> {
  setStatus(path, false)
  await flushSession()
}

/**
 * Pick the document back up from the last session.
 *
 * Runs before the first window exists, which is what lets the renderer take the
 * document synchronously at preload and never render a half-restored state — the
 * same bargain `data:snapshot` and `keymap:snapshot` already make.
 *
 * Parsed rather than trusted. `session.json` is a file on the disk like any
 * other, and the renderer no longer has a chance to reject it: a malformed tree
 * arriving synchronously at preload is a renderer that cannot draw its first
 * frame.
 */
export async function restore(): Promise<void> {
  const session = await readSession()
  if (!session?.doc) return
  const parsed = parseLayoutDoc(session.doc)
  if (!parsed) {
    console.warn('session.json does not hold a valid layout; starting empty.')
    return
  }
  doc = parsed
  filePath = session.filePath ?? null
  dirty = session.dirty === true

  // Checked one at a time rather than trusted as a block: a rectangle read off
  // the disk reaches the OS, which takes a negative size literally.
  const live = new Set(parsed.windows.map((window) => window.id))
  bounds = Object.fromEntries(
    Object.entries(session.bounds ?? {}).filter(
      ([id, value]) => live.has(id) && isUsableBounds(value)
    )
  )
}
