/**
 * Data pack index and loader. Same shape as `userStore.ts` — a JSON file in
 * userData, read tolerantly, written via temp + rename.
 *
 * Packs are referenced by path rather than copied in, so editing a pack file and
 * choosing *Reload Data Packs from Disk* shows the change. The cost is that a moved file
 * empties whatever it provided; that lands in `failed` so the UI can say so,
 * rather than the panel quietly going thin.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { parseDataPack } from '../shared/dataPack'
import {
  DATASETS,
  type DataPack,
  type DataPackError,
  type DataPackRef,
  type DataSnapshot,
  type Dataset
} from '../shared/types'

interface PackIndex {
  refs: DataPackRef[]
  enabled: Record<Dataset, boolean>
}

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

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

function allEnabled(): Record<Dataset, boolean> {
  return Object.fromEntries(DATASETS.map((dataset) => [dataset, true])) as Record<Dataset, boolean>
}

/** Tolerant of a hand-edited or partial index — anything missing falls back to on. */
async function readIndex(): Promise<PackIndex> {
  const raw = await readJson<Partial<PackIndex>>(userFile('datapacks.json'))
  const enabled = allEnabled()

  for (const dataset of DATASETS) {
    if (raw?.enabled?.[dataset] === false) enabled[dataset] = false
  }

  const refs = Array.isArray(raw?.refs)
    ? raw.refs.filter(
        (ref): ref is DataPackRef =>
          !!ref && typeof ref.id === 'string' && typeof ref.path === 'string'
      )
    : []

  return { refs, enabled }
}

async function writeIndex(index: PackIndex): Promise<void> {
  await writeJson(userFile('datapacks.json'), index)
}

/**
 * The cached snapshot. Loaded once before the window opens so the renderer can
 * take it synchronously and never has to render a "not loaded yet" state.
 */
let snapshot: DataSnapshot = { packs: [], refs: [], enabled: allEnabled(), failed: [] }

export function currentSnapshot(): DataSnapshot {
  return snapshot
}

/** Reads every indexed pack off disk. A pack that fails is reported, not fatal. */
export async function loadPacks(): Promise<DataSnapshot> {
  const index = await readIndex()
  const packs: DataPack[] = []
  const refs: DataPackRef[] = []
  const failed: DataPackError[] = []

  for (const ref of index.refs) {
    const raw = await readJson<unknown>(ref.path)
    if (raw === null) {
      failed.push({ path: ref.path, reason: 'could not be read' })
      continue
    }

    const parsed = parseDataPack(raw)
    if (!parsed) {
      failed.push({ path: ref.path, reason: 'is not a valid data pack' })
      continue
    }

    packs.push(parsed.pack)
    refs.push({ id: parsed.pack.id, name: parsed.pack.name, path: ref.path })
  }

  snapshot = { packs, refs, enabled: index.enabled, failed }
  return snapshot
}

/** Returns null when the file is unreadable or not a pack; the caller reports. */
export async function addPack(path: string): Promise<DataSnapshot | null> {
  const raw = await readJson<unknown>(path)
  if (raw === null) return null

  const parsed = parseDataPack(raw)
  if (!parsed) return null

  const index = await readIndex()
  // Replacing by id rather than appending: two sources sharing a namespace would
  // defeat the point of namespacing them.
  const refs = index.refs.filter((ref) => ref.id !== parsed.pack.id && ref.path !== path)
  refs.push({ id: parsed.pack.id, name: parsed.pack.name, path })

  await writeIndex({ ...index, refs })
  return loadPacks()
}

export async function removePack(id: string): Promise<DataSnapshot> {
  const index = await readIndex()
  await writeIndex({ ...index, refs: index.refs.filter((ref) => ref.id !== id) })
  return loadPacks()
}

export async function setDatasetEnabled(
  datasets: Dataset[],
  value: boolean
): Promise<DataSnapshot> {
  const index = await readIndex()
  const enabled = { ...index.enabled }
  for (const dataset of datasets) enabled[dataset] = value

  await writeIndex({ ...index, enabled })
  return loadPacks()
}
