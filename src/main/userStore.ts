import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import type { RecentEntry, SessionSnapshot } from '../shared/types'
import { sanitiseKeymap, type Keymap, type KeymapLoad } from '../shared/actions'

const MAX_RECENTS = 12

function userFile(name: string): string {
  return join(app.getPath('userData'), name)
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * Write via a temp file + rename so a crash mid-write can't leave a truncated
 * session/recents file behind (which would silently wipe the user's state).
 */
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

export async function listRecents(): Promise<RecentEntry[]> {
  return (await readJson<RecentEntry[]>(userFile('recents.json'))) ?? []
}

export async function addRecent(path: string, name: string): Promise<RecentEntry[]> {
  const existing = await listRecents()
  const next: RecentEntry[] = [
    { path, name, openedAt: new Date().toISOString() },
    ...existing.filter((entry) => entry.path !== path)
  ].slice(0, MAX_RECENTS)
  await writeJson(userFile('recents.json'), next)
  return next
}

export async function removeRecent(path: string): Promise<RecentEntry[]> {
  const next = (await listRecents()).filter((entry) => entry.path !== path)
  await writeJson(userFile('recents.json'), next)
  return next
}

export async function clearRecents(): Promise<RecentEntry[]> {
  await writeJson(userFile('recents.json'), [])
  return []
}

/**
 * Keybindings live here rather than in the session, for the reason data packs
 * live outside `useAppStore`: everything in the session rides along with
 * `dirty`, and rebinding a key must never mark a layout unsaved.
 */
export async function readKeymap(): Promise<KeymapLoad> {
  return sanitiseKeymap(await readJson<unknown>(userFile('keybindings.json')))
}

export async function writeKeymap(keymap: Keymap): Promise<void> {
  await writeJson(userFile('keybindings.json'), keymap)
}

export async function readSession(): Promise<SessionSnapshot | null> {
  return readJson<SessionSnapshot>(userFile('session.json'))
}

export async function writeSession(snapshot: SessionSnapshot): Promise<void> {
  await writeJson(userFile('session.json'), snapshot)
}
