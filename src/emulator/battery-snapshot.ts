import { unzlibSync } from 'fflate'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const MAX_BATTERY_SIZE = 1024 * 1024

/** Read live SRAM from a PNG state produced by the bundled mGBA core.
 * Its gbAx extension stores a little-endian tag, uncompressed size and zlib
 * data; EXTDATA_SAVEDATA is tag 2. This avoids the core's delayed MEMFS flush.
 * See the pinned upstream src/core/serialize.c and include/mgba/core/serialize.h.
 * This function is only used for native snapshots, never imported user states.
 */
export function batteryFromState(
  state: Uint8Array,
  savedFile?: Uint8Array | null,
): Uint8Array | null {
  const invalid = () => new Error('无法读取模拟核心的电池存档快照，请重试或先导出即时存档。')
  if (!PNG_SIGNATURE.every((byte, index) => state[index] === byte)) throw invalid()
  const view = new DataView(state.buffer, state.byteOffset, state.byteLength)
  let battery: Uint8Array | null = null
  for (let offset = PNG_SIGNATURE.length; offset + 12 <= state.length;) {
    const length = view.getUint32(offset)
    const end = offset + length + 12
    if (end > state.length) throw invalid()
    const tag = String.fromCharCode(...state.subarray(offset + 4, offset + 8))
    if (tag === 'gbAx') {
      if (length < 8) throw invalid()
      if (view.getUint32(offset + 8, true) === 2) {
        const size = view.getUint32(offset + 12, true)
        if (battery || size < 1 || size > MAX_BATTERY_SIZE) throw invalid()
        try {
          // One extra byte detects payloads larger than the declared size while
          // keeping decompression memory bounded if a native state is malformed.
          battery = unzlibSync(state.subarray(offset + 16, end - 4), {
            out: new Uint8Array(size + 1),
          })
        } catch {
          throw invalid()
        }
        if (battery.length !== size) throw invalid()
      }
    }
    if (tag === 'IEND') {
      if (length !== 0 || end !== state.length) throw invalid()
      // Auto-detected EEPROM may not be accessed until much later in a game.
      // Before the core has cartridge memory to clone, retain an imported file.
      if (!battery) return savedFile?.length ? new Uint8Array(savedFile) : null
      // savedataClone contains cartridge bytes only. Keep native file trailers
      // such as mGBA's RTC record, whose updates remain managed by the core.
      if (savedFile && savedFile.length > battery.length) {
        const complete = new Uint8Array(savedFile)
        complete.set(battery)
        return complete
      }
      return battery
    }
    offset = end
  }
  throw invalid()
}
