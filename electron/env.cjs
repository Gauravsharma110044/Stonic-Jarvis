// Tiny .env loader (KEY=VALUE lines) - avoids extra deps
const fs = require('fs')
const path = require('path')

function loadEnv(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch {}
}

loadEnv(path.join(__dirname, '..', '.env'))

module.exports = { loadEnv }
