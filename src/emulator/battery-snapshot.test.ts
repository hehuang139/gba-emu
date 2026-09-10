import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { batteryFromState } from './battery-snapshot.ts'

// The format is defined by mGBA's PNGWriteCustomChunk and EXTDATA_SAVEDATA.
// CRCs are placeholders here: the extractor reads only core-produced chunks.
function chunk(tag: string, bytes = Buffer.alloc(0)) {
  const result = Buffer.alloc(bytes.length + 12)
  result.writeUInt32BE(bytes.length)
  result.write(tag, 4, 'ascii')
  bytes.copy(result, 8)
  return result
}

function savedata(bytes: Uint8Array, declaredSize = bytes.length, tag = 2) {
  const header = Buffer.alloc(8)
  header.writeUInt32LE(tag)
  header.writeUInt32LE(declaredSize, 4)
  return chunk('gbAx', Buffer.concat([header, deflateSync(bytes)]))
}

function state(...chunks: Buffer[]) {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks, chunk('IEND')])
}

test('extracts current SRAM from the mGBA extension independently of screenshot and metadata chunks', () => {
  const battery = new Uint8Array(32768).fill(255)
  battery.set([83, 79, 1, 7, 248])
  const snapshot = state(
    chunk('IDAT', Buffer.from([1, 2, 3])),
    savedata(battery),
    savedata(new Uint8Array(16), 16, 4),
  )
  const padded = Buffer.concat([Buffer.from([9]), snapshot, Buffer.from([9])])
  assert.deepEqual(batteryFromState(padded.subarray(1, -1)), battery)
})

test('a native state without battery data returns null', () => {
  assert.equal(batteryFromState(state(savedata(new Uint8Array(16), 16, 4))), null)
})

test('retains an imported file until the core detects the cartridge save type', () => {
  const imported = new Uint8Array([1, 2, 3, 4])
  const result = batteryFromState(state(savedata(new Uint8Array(16), 16, 4)), imported)
  assert.deepEqual(result, imported)
  assert.notEqual(result, imported)
})

test('replaces stale cartridge bytes while preserving native save file trailers', () => {
  const snapshot = state(savedata(new Uint8Array([83, 79, 1, 7, 248])))
  const existing = new Uint8Array([0, 0, 0, 0, 0, 10, 20, 30, 40])
  assert.deepEqual(
    batteryFromState(snapshot, existing),
    new Uint8Array([83, 79, 1, 7, 248, 10, 20, 30, 40]),
  )
  assert.deepEqual(
    existing,
    new Uint8Array([0, 0, 0, 0, 0, 10, 20, 30, 40]),
    'the core file is never mutated',
  )
})

test('rejects malformed chunk boundaries and missing PNG terminators', () => {
  const snapshot = state(savedata(new Uint8Array([1, 2, 3])))
  for (const bytes of [
    new Uint8Array(),
    snapshot.subarray(0, -1),
    snapshot.subarray(0, -12),
    state(chunk('gbAx')),
  ]) {
    assert.throws(() => batteryFromState(bytes), /电池存档快照/)
  }
  const broken = Buffer.from(snapshot)
  broken.writeUInt32BE(0xffffffff, 8)
  assert.throws(() => batteryFromState(broken), /电池存档快照/)
})

test('rejects oversized, truncated, duplicate and invalid compressed SRAM payloads', () => {
  for (const declared of [0, 2, 4, 1024 * 1024 + 1]) {
    assert.throws(
      () => batteryFromState(state(savedata(new Uint8Array([1, 2, 3]), declared))),
      /电池存档快照/,
    )
  }
  const entry = savedata(new Uint8Array([1, 2, 3]))
  assert.throws(() => batteryFromState(state(entry, entry)), /电池存档快照/)
  const invalid = Buffer.from(entry)
  invalid[16] = 0
  assert.throws(() => batteryFromState(state(invalid)), /电池存档快照/)
})
