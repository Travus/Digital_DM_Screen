/** Condenses `npm audit --json` (piped in on stdin) into one line per package. */
const raw = await new Promise((resolve) => {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => (buffer += chunk))
  process.stdin.on('end', () => resolve(buffer))
})

const audit = JSON.parse(raw)
const rows = Object.values(audit.vulnerabilities ?? {}).map((entry) => ({
  name: entry.name,
  severity: entry.severity,
  direct: entry.isDirect,
  range: entry.range,
  fixAvailable:
    entry.fixAvailable === true
      ? 'yes'
      : entry.fixAvailable
        ? `${entry.fixAvailable.name}@${entry.fixAvailable.version}${entry.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
        : 'no'
}))

rows.sort((a, b) => a.name.localeCompare(b.name))
for (const row of rows) {
  console.log(
    [
      row.severity.padEnd(9),
      row.name.padEnd(26),
      (row.direct ? 'direct' : 'transitive').padEnd(11),
      `fix: ${row.fixAvailable}`
    ].join(' ')
  )
}

console.log('---')
console.log(JSON.stringify(audit.metadata?.vulnerabilities ?? {}))
