/**
 * Launches the packaged Apple-silicon app, waits for the main process's smoke
 * hook to capture its first rendered frame, and fails if the app cannot start.
 * Intended for the native macOS CI runner; never run the Node toolchain on the
 * user's host.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'release', 'smoke-mac')
const shotPath = join(outDir, 'packaged.png')
const userData = join(outDir, 'user-data')
const executable = join(
  root,
  'release',
  'mac-arm64',
  'Digital DM Screen.app',
  'Contents',
  'MacOS',
  'Digital DM Screen'
)

if (!existsSync(executable)) {
  throw new Error(`Packaged app executable not found: ${executable}`)
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

const output = await new Promise((resolvePromise, reject) => {
  const child = spawn(executable, [`--user-data-dir=${userData}`], {
    cwd: root,
    env: {
      ...process.env,
      DMSCREEN_SMOKE_SHOT: shotPath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let logs = ''
  child.stdout.on('data', (chunk) => (logs += chunk))
  child.stderr.on('data', (chunk) => (logs += chunk))

  const timer = setTimeout(() => {
    child.kill('SIGKILL')
    reject(new Error(`Timed out waiting for packaged macOS app.\n${logs}`))
  }, 60_000)

  child.on('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })

  child.on('exit', (code) => {
    clearTimeout(timer)
    if (code !== 0) {
      reject(new Error(`Packaged macOS app exited with ${code}.\n${logs}`))
      return
    }
    resolvePromise(logs)
  })
})

if (!existsSync(shotPath)) throw new Error(`Packaged app wrote no screenshot.\n${output}`)

const problems = String(output)
  .split('\n')
  .filter((line) => /\[renderer:(error)\]|Uncaught|ERR_FILE_NOT_FOUND/.test(line))
if (problems.length) throw new Error(`Renderer reported problems:\n${problems.join('\n')}`)

console.log(`Packaged macOS app rendered successfully → ${shotPath}`)
