import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const wasmPath = path.join(root, 'public', 'emulator', 'mgba.wasm')
const noticePath = path.join(root, 'public', 'emulator', 'NOTICE.md')

function fail(message) {
  console.error(`Core asset verification failed: ${message}`)
  process.exitCode = 1
}

try {
  const [notice, wasm] = await Promise.all([readFile(noticePath, 'utf8'), readFile(wasmPath)])
  const match = notice.match(/Original WebAssembly SHA-256:\s*`([0-9a-f]{64})`/i)
  if (!match) throw new Error('NOTICE.md does not contain an Original WebAssembly SHA-256 value.')

  const expected = match[1].toLowerCase()
  const actual = createHash('sha256').update(wasm).digest('hex')
  if (actual !== expected) {
    throw new Error(`mgba.wasm hash mismatch (expected ${expected}, got ${actual}).`)
  }

  console.log(`Core asset verified: mgba.wasm SHA-256 ${actual}`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
