import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { deleteGame, deleteState, getBatterySave, getGames, getRom, getState, getStates, importGame, saveState, setBatterySave, updateGame } from './storage.ts'

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

function rom(name = 'Test_game.gba', seed = 1, size = 1024): File {
  return new File([new Uint8Array(size).fill(seed)], name)
}

async function corrupt(store: string, record: object): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('advance-gba', 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(record)
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

test('imports content once even when concurrent imports use different filenames', async () => {
  assert.deepEqual(await getGames(), [])
  const [a, b] = await Promise.all([importGame(rom()), importGame(rom('Renamed.GBA'))])
  assert.equal(a.id, b.id)
  assert.match(a.id, /^[0-9a-f]{64}$/)
  assert.equal((await getGames()).length, 1)
  assert.deepEqual(await getRom(a.id), new Uint8Array(1024).fill(1))
  await updateGame(a.id, { favorite: true, playTime: 34, title: 'My game' })
  const again = await importGame(rom('Third.gba'))
  assert.equal(again.title, 'My game')
  assert.equal(again.playTime, 34)
  assert.equal(again.favorite, true)
})

test('validates ROM file type and hardware size bounds before storing', async () => {
  await assert.rejects(importGame(rom('wrong.zip')), /\.gba/)
  await assert.rejects(importGame(rom('small.gba', 1, 191)), /大小无效/)
  await assert.rejects(importGame(rom('large.gba', 1, 32 * 1024 * 1024 + 1)), /大小无效/)
  assert.deepEqual(await getGames(), [])
  assert.equal((await importGame(rom('minimum.gba', 1, 192))).size, 192)
})

test('updates merge metadata, preserve identity, and serialize concurrent edits', async () => {
  const game = await importGame(rom())
  await Promise.all([updateGame(game.id, { favorite: true }), updateGame(game.id, { playTime: 125 })])
  const updated = await updateGame(game.id, { id: 'different-id', lastPlayed: Date.now() })
  assert.equal(updated.id, game.id)
  assert.equal(updated.favorite, true)
  assert.equal(updated.playTime, 125)
  assert.equal(updated.filename, game.filename)
  await assert.rejects(updateGame(game.id, { playTime: -1 }), /游戏信息已损坏/)
  assert.equal((await getGames())[0].playTime, 125)
  await assert.rejects(updateGame('missing', { favorite: true }), /游戏不存在/)
})

test('save slots overwrite atomically and do not expose stored byte buffers', async () => {
  const game = await importGame(rom())
  const bytes = new Uint8Array([1, 2, 3])
  await saveState(game.id, 2, bytes, 'data:image/png;base64,test')
  bytes[0] = 99
  const first = await getState(game.id, 2)
  assert.deepEqual(first?.data, new Uint8Array([1, 2, 3]))
  first!.data[1] = 99
  assert.equal((await getState(game.id, 2))?.data[1], 2)
  await saveState(game.id, 2, new Uint8Array([4, 5]))
  await saveState(game.id, 0, new Uint8Array([8]))
  const states = await getStates(game.id)
  assert.deepEqual(states.map(state => state.slot), [0, 2])
  assert.deepEqual(states[1].data, new Uint8Array([4, 5]))
  assert.equal(states[1].screenshot, undefined)
  await deleteState(game.id, 2)
  assert.equal(await getState(game.id, 2), undefined)
  await assert.rejects(saveState(game.id, -1, bytes), /槽位无效/)
  await assert.rejects(saveState(game.id, 1, new Uint8Array()), /存档已损坏/)
})

test('deleting a game removes ROM, battery, and states without affecting another game', async () => {
  const a = await importGame(rom())
  const b = await importGame(rom('Other.gba', 2))
  for (const game of [a, b]) {
    await setBatterySave(game.id, new Uint8Array([6, 7]))
    await saveState(game.id, 0, new Uint8Array([3, 4]))
    await saveState(game.id, 1, new Uint8Array([5, 6]))
  }
  await deleteGame(a.id)
  assert.deepEqual((await getGames()).map(game => game.id), [b.id])
  assert.equal(await getRom(a.id), undefined)
  assert.equal(await getBatterySave(a.id), undefined)
  assert.deepEqual(await getStates(a.id), [])
  assert.equal((await getStates(b.id)).length, 2)
  assert.deepEqual(await getBatterySave(b.id), new Uint8Array([6, 7]))
  assert.equal((await getRom(b.id))?.length, 1024)
  await deleteGame(a.id)
  await assert.rejects(saveState(a.id, 1, new Uint8Array([1])), /游戏不存在/)
  await assert.rejects(setBatterySave(a.id, new Uint8Array([1])), /游戏不存在/)
})

test('detects corrupted persisted ROMs and repairs bytes on reimport', async () => {
  const game = await importGame(rom())
  await corrupt('roms', { id: game.id, data: new Uint8Array([1]) })
  await assert.rejects(getRom(game.id), /ROM 数据已损坏/)
  await importGame(rom())
  assert.equal((await getRom(game.id))?.length, 1024)
  await corrupt('roms', { id: game.id, data: 'invalid bytes' })
  await assert.rejects(getRom(game.id), /ROM 数据已损坏/)
})

test('rejects corrupted state, battery, and library metadata with actionable errors', async () => {
  const game = await importGame(rom())
  await corrupt('states', { id: `${game.id}:1`, gameId: game.id, slot: 1, createdAt: Date.now(), data: [1, 2] })
  await assert.rejects(getState(game.id, 1), /即时存档已损坏/)
  await assert.rejects(getStates(game.id), /即时存档已损坏/)
  await corrupt('batteries', { gameId: game.id, data: 'invalid' })
  await assert.rejects(getBatterySave(game.id), /电池存档已损坏/)
  await corrupt('games', { ...game, playTime: Number.NaN })
  await assert.rejects(getGames(), /游戏信息已损坏/)
  // Deletion remains available even when the metadata cannot be parsed.
  await deleteGame(game.id)
  assert.deepEqual(await getGames(), [])
})

test('explains unavailable browser storage in Chinese', async () => {
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, writable: true, configurable: true })
  await assert.rejects(getGames(), /不支持本地游戏库/)
})
