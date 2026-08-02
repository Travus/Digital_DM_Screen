/**
 * Supply-chain gate over package-lock.json.
 *
 *   docker compose run --rm -T build node scripts/audit-deps.mjs
 *
 * Reports the resolved tree, and **exits non-zero** on the three things that
 * should never change quietly: a package served from somewhere other than the
 * public registry, a package with no integrity hash, and any movement in the set
 * of packages allowed to run install scripts.
 *
 * That last one is the point of the whole script. A dependency bump that quietly
 * grows a `postinstall` is what an npm supply-chain attack actually looks like,
 * and it is invisible in a diff of package.json.
 *
 * Read the lockfile, never node_modules. A check that stats installed packages
 * reports a clean tree when nothing is installed — which is exactly the state CI
 * runs it in.
 */
import { readFile } from 'node:fs/promises'

/**
 * Packages permitted to run install scripts, with why. Adding to this list is a
 * deliberate act — read the script before you do.
 */
const INSTALL_SCRIPT_ALLOWLIST = new Set([
  'electron-winstaller', // unpacks the Windows installer toolchain
  'esbuild', // fetches its platform binary
  'fsevents' // macOS file watcher; optional, never installed on Linux
])

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
    hasIntegrity: Boolean(meta.integrity),
    hasInstallScript: meta.hasInstallScript === true
  }))

const unique = new Map()
for (const entry of entries) {
  if (!unique.has(entry.name)) unique.set(entry.name, entry)
}

const byName = (a, b) => a.name.localeCompare(b.name)
const problems = []

console.log(`packages in tree: ${entries.length} (${unique.size} distinct names)`)
console.log(`production (shipped) dependencies: ${entries.filter((e) => !e.dev).length}`)

// Should always be zero. Anything here is either a git/tarball dependency
// someone added on purpose, or a lockfile that has been tampered with.
const offRegistry = entries.filter(
  (entry) => entry.resolved && !entry.resolved.startsWith('https://registry.npmjs.org/')
)
console.log(`\n--- resolved outside registry.npmjs.org: ${offRegistry.length}`)
for (const entry of offRegistry)
  console.log(`  ${entry.name}@${entry.version} -> ${entry.resolved}`)
if (offRegistry.length) problems.push(`${offRegistry.length} package(s) resolved off-registry`)

// Also always zero: without an integrity hash npm cannot tell whether it got
// the bytes it asked for.
const noIntegrity = entries.filter((entry) => entry.resolved && !entry.hasIntegrity)
console.log(`\n--- missing integrity hash: ${noIntegrity.length}`)
for (const entry of noIntegrity) console.log(`  ${entry.name}@${entry.version}`)
if (noIntegrity.length) problems.push(`${noIntegrity.length} package(s) missing an integrity hash`)

const installScripts = entries.filter((entry) => entry.hasInstallScript).sort(byName)
console.log(`\n--- packages with install scripts: ${installScripts.length}`)
for (const entry of installScripts) {
  const known = INSTALL_SCRIPT_ALLOWLIST.has(entry.name)
  console.log(
    `  ${known ? ' ' : '!'} ${entry.path}@${entry.version}${entry.optional ? ' (optional)' : ''}`
  )
}

const unexpected = installScripts.filter((entry) => !INSTALL_SCRIPT_ALLOWLIST.has(entry.name))
if (unexpected.length) {
  problems.push(
    `${unexpected.length} package(s) run install scripts without being allowlisted: ` +
      // Paths, not names: the same package can appear at several tree positions,
      // and "esbuild, esbuild" tells you nothing about which one moved.
      unexpected.map((entry) => entry.path).join(', ')
  )
}

// A package dropping its install script is not a risk, but it does mean the
// allowlist is now describing something that no longer exists.
const stale = [...INSTALL_SCRIPT_ALLOWLIST].filter(
  (name) => !installScripts.some((entry) => entry.name === name)
)
if (stale.length) {
  console.log(`\nnote: allowlisted but no longer running install scripts: ${stale.join(', ')}`)
}

console.log('\n--- full package list')
for (const entry of [...unique.values()].sort(byName)) {
  console.log(`  ${entry.name}@${entry.version}${entry.optional ? ' (optional)' : ''}`)
}

if (problems.length) {
  console.error(`\nFAILED:`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('\nOK: nothing off-registry, nothing unhashed, install scripts unchanged.')
