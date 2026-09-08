import type { Game, SaveState } from './types.ts'

const DATABASE_NAME = 'advance-gba'
const DATABASE_VERSION = 1
const MIN_ROM_SIZE = 192
const MAX_ROM_SIZE = 32 * 1024 * 1024
const STORES = { games: 'games', roms: 'roms', states: 'states', batteries: 'batteries' } as const

function storageError(error: unknown): Error {
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) return error
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'QuotaExceededError') return new Error('本地存储空间不足，请删除不需要的游戏或存档后重试。')
  if (name === 'SecurityError' || name === 'InvalidStateError') return new Error('浏览器无法访问本地存储，请检查隐私设置或退出无痕模式后重试。')
  if (name === 'VersionError') return new Error('本地游戏库版本较新，请刷新页面或更新应用后重试。')
  return new Error('本地游戏库读写失败，请刷新页面后重试。', { cause: error })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本地游戏库，请使用支持 IndexedDB 的现代浏览器。'))
      return
    }
    let request: IDBOpenDBRequest
    try { request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION) } catch (error) { reject(storageError(error)); return }
    let blocked = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORES.games)) db.createObjectStore(STORES.games, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.roms)) db.createObjectStore(STORES.roms, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORES.batteries)) db.createObjectStore(STORES.batteries, { keyPath: 'gameId' })
      if (!db.objectStoreNames.contains(STORES.states)) {
        const states = db.createObjectStore(STORES.states, { keyPath: 'id' })
        states.createIndex('gameId', 'gameId', { unique: false })
      }
    }
    request.onblocked = () => {
      blocked = true
      reject(new Error('游戏库正在另一窗口中使用，请关闭旧版页面后重试。'))
    }
    request.onerror = () => reject(storageError(request.error))
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDatabase()
  let tx: IDBTransaction
  try { tx = db.transaction(stores, mode) } catch (error) { db.close(); throw storageError(error) }
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('本地游戏库操作已取消，请重试。'))
    tx.onerror = () => { /* onabort owns the final transaction error. */ }
  })
  // Mark the rejection handled even if it arrives before an awaited request.
  void completion.catch(() => {})
  try {
    const result = await work(tx)
    await completion
    return result
  } catch (error) {
    try { tx.abort() } catch { /* The transaction may already have finished. */ }
    await completion.catch(() => {})
    throw storageError(error)
  } finally { db.close() }
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function gameRecord(value: unknown): Game {
  if (!value || typeof value !== 'object') throw new Error('游戏信息已损坏，请删除后重新导入 ROM。')
  const game = value as Game
  if (typeof game.id !== 'string' || !game.id || typeof game.title !== 'string' || !game.title.trim()
    || typeof game.filename !== 'string' || !game.filename || !Number.isInteger(game.size)
    || game.size < MIN_ROM_SIZE || game.size > MAX_ROM_SIZE || !isTimestamp(game.addedAt)
    || (game.lastPlayed !== null && !isTimestamp(game.lastPlayed)) || !isTimestamp(game.playTime)
    || typeof game.favorite !== 'boolean' || (game.color !== undefined && typeof game.color !== 'string')) {
    throw new Error('游戏信息已损坏，请删除后重新导入 ROM。')
  }
  return game
}

function copyBytes(value: unknown, message: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new Error(message)
  return new Uint8Array(value)
}

function stateId(gameId: string, slot: number): string {
  if (!gameId || !Number.isSafeInteger(slot) || slot < 0) throw new Error('存档槽位无效，请选择有效的存档槽位。')
  return `${gameId}:${slot}`
}

function stateRecord(value: unknown): SaveState {
  if (!value || typeof value !== 'object') throw new Error('即时存档已损坏，请使用其他存档。')
  const state = value as SaveState
  if (typeof state.gameId !== 'string' || !state.gameId || !Number.isSafeInteger(state.slot) || state.slot < 0
    || state.id !== `${state.gameId}:${state.slot}` || !isTimestamp(state.createdAt)
    || (state.screenshot !== undefined && typeof state.screenshot !== 'string')) {
    throw new Error('即时存档已损坏，请使用其他存档。')
  }
  return { ...state, data: copyBytes(state.data, '即时存档已损坏，请使用其他存档。') }
}

async function requireGame(tx: IDBTransaction, id: string): Promise<Game> {
  const value = await requestResult(tx.objectStore(STORES.games).get(id))
  if (value === undefined) throw new Error('游戏不存在，请先导入 ROM。')
  return gameRecord(value)
}

export async function getGames(): Promise<Game[]> {
  return transaction([STORES.games], 'readonly', async tx => {
    const games = await requestResult(tx.objectStore(STORES.games).getAll())
    return games.map(gameRecord).sort((a, b) => (b.lastPlayed ?? b.addedAt) - (a.lastPlayed ?? a.addedAt))
  })
}

export async function importGame(file: File): Promise<Game> {
  if (!/\.gba$/i.test(file.name)) throw new Error('请选择 .gba 格式的 Game Boy Advance 游戏文件。')
  if (file.size < MIN_ROM_SIZE || file.size > MAX_ROM_SIZE) throw new Error('ROM 大小无效，GBA 游戏文件应为 192 字节至 32 MB。')
  let bytes: Uint8Array
  try { bytes = new Uint8Array(await file.arrayBuffer()) } catch { throw new Error('无法读取游戏文件，请重新选择后重试。') }
  if (bytes.byteLength !== file.size) throw new Error('游戏文件读取不完整，请重新选择后重试。')
  if (!globalThis.crypto?.subtle) throw new Error('浏览器无法校验游戏文件，请使用 HTTPS 或 localhost 打开应用。')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return transaction([STORES.games, STORES.roms], 'readwrite', async tx => {
    const existing = await requestResult(tx.objectStore(STORES.games).get(id))
    const game = existing === undefined ? {
      id, title: file.name.replace(/\.gba$/i, '').replace(/[_]+/g, ' ').trim() || '未命名游戏',
      filename: file.name, size: bytes.byteLength, addedAt: Date.now(), lastPlayed: null,
      playTime: 0, favorite: false,
    } satisfies Game : gameRecord(existing)
    // Reimporting deduplicates metadata while repairing any missing ROM bytes.
    await requestResult(tx.objectStore(STORES.roms).put({ id, data: bytes }))
    if (existing === undefined) await requestResult(tx.objectStore(STORES.games).add(game))
    return game
  })
}

export async function updateGame(id: string, changes: Partial<Game>): Promise<Game> {
  return transaction([STORES.games], 'readwrite', async tx => {
    const current = await requireGame(tx, id)
    const updated = gameRecord({ ...current, ...changes, id: current.id })
    await requestResult(tx.objectStore(STORES.games).put(updated))
    return updated
  })
}

export async function getRom(id: string): Promise<Uint8Array | undefined> {
  return transaction([STORES.games, STORES.roms], 'readonly', async tx => {
    const record = await requestResult(tx.objectStore(STORES.roms).get(id))
    if (record === undefined) return undefined
    const game = await requireGame(tx, id)
    const bytes = copyBytes(record.data, '游戏 ROM 数据已损坏，请重新导入游戏。')
    if (bytes.byteLength !== game.size) throw new Error('游戏 ROM 数据已损坏，请重新导入游戏。')
    return bytes
  })
}

export async function deleteGame(id: string): Promise<void> {
  return transaction(Object.values(STORES), 'readwrite', async tx => {
    const stateKeys = await requestResult(tx.objectStore(STORES.states).index('gameId').getAllKeys(id))
    await Promise.all([
      requestResult(tx.objectStore(STORES.games).delete(id)),
      requestResult(tx.objectStore(STORES.roms).delete(id)),
      requestResult(tx.objectStore(STORES.batteries).delete(id)),
      ...stateKeys.map(key => requestResult(tx.objectStore(STORES.states).delete(key))),
    ])
  })
}

export async function getStates(gameId: string): Promise<SaveState[]> {
  return transaction([STORES.states], 'readonly', async tx => {
    const states = await requestResult(tx.objectStore(STORES.states).index('gameId').getAll(gameId))
    return states.map(stateRecord).sort((a, b) => a.slot - b.slot)
  })
}

export async function getState(gameId: string, slot: number): Promise<SaveState | undefined> {
  const id = stateId(gameId, slot)
  return transaction([STORES.states], 'readonly', async tx => {
    const value = await requestResult(tx.objectStore(STORES.states).get(id))
    return value === undefined ? undefined : stateRecord(value)
  })
}

export async function saveState(gameId: string, slot: number, data: Uint8Array, screenshot?: string): Promise<SaveState> {
  const id = stateId(gameId, slot)
  const state = stateRecord({ id, gameId, slot, data, screenshot, createdAt: Date.now() })
  return transaction([STORES.games, STORES.states], 'readwrite', async tx => {
    await requireGame(tx, gameId)
    await requestResult(tx.objectStore(STORES.states).put(state))
    return state
  })
}

export async function deleteState(gameId: string, slot: number): Promise<void> {
  const id = stateId(gameId, slot)
  return transaction([STORES.states], 'readwrite', async tx => {
    await requestResult(tx.objectStore(STORES.states).delete(id))
  })
}

export async function getBatterySave(gameId: string): Promise<Uint8Array | undefined> {
  return transaction([STORES.batteries], 'readonly', async tx => {
    const record = await requestResult(tx.objectStore(STORES.batteries).get(gameId))
    return record === undefined ? undefined : copyBytes(record.data, '游戏电池存档已损坏，请导入备份存档。')
  })
}

export async function setBatterySave(gameId: string, data: Uint8Array): Promise<void> {
  const bytes = copyBytes(data, '电池存档为空或格式无效，请选择有效的 .sav 文件。')
  return transaction([STORES.games, STORES.batteries], 'readwrite', async tx => {
    await requireGame(tx, gameId)
    await requestResult(tx.objectStore(STORES.batteries).put({ gameId, data: bytes }))
  })
}
