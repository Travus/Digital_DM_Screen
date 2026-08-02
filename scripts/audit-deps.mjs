/**
 * Supply-chain sanity check over package-lock.json.
 *
 *   docker compose run --rm build node scripts/audit-deps.mjs
 *
 * Reports the full resolved tree, flags anything not served from the public npm
 * registry, and lists every package that runs an install script — the two things
 * worth eyeballing by hand after a dependency change.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))

const entries = Object.entries(lock.packages)
  .filter(([path]) => path.startsWith('node_modules/'))
  .map(([path, meta]) => ({
    name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
    path,
    version: meta.version,
    resolved: meta.resolved,
    dev: meta.dev === true,
    optional: meta.optional === true,
    hasIntegrity: Boolean(meta.integrity)
  }))

const unique = new Map()
for (const entry of entries) {
  if (!unique.has(entry.name)) unique.set(entry.name, entry)
}

console.log(`packages in tree: ${entries.length} (${unique.size} distinct names)`)
console.log(`production (shipped) dependencies: ${entries.filter((e) => !e.dev).length}`)

const offRegistry = entries.filter(
  (entry) => entry.resolved && !entry.resolved.startsWith('https://registry.npmjs.org/')
)
console.log(`\n--- resolved outside registry.npmjs.org: ${offRegistry.length}`)
for (const entry of offRegistry)
  console.log(`  ${entry.name}@${entry.version} -> ${entry.resolved}`)

const noIntegrity = entries.filter((entry) => entry.resolved && !entry.hasIntegrity)
console.log(`\n--- missing integrity hash: ${noIntegrity.length}`)
for (const entry of noIntegrity) console.log(`  ${entry.name}@${entry.version}`)

console.log('\n--- packages with install scripts')
const lifecycle = ['preinstall', 'install', 'postinstall']
for (const entry of [...unique.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const manifest = join(entry.path, 'package.json')
  if (!existsSync(manifest)) continue
  const scripts = JSON.parse(await readFile(manifest, 'utf8')).scripts ?? {}
  const hits = lifecycle.filter((name) => scripts[name])
  if (hits.length) {
    console.log(`  ${entry.name}@${entry.version}`)
    for (const hit of hits) console.log(`      ${hit}: ${scripts[hit]}`)
  }
}

console.log('\n--- full package list')
for (const entry of [...unique.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  console.log(`  ${entry.name}@${entry.version}${entry.optional ? ' (optional)' : ''}`)
}
