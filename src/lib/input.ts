import type { GbaButton } from '../emulator'

/** A button stays held until every physical input source has released it. */
export function createInputController(
  press: (button: GbaButton) => void,
  release: (button: GbaButton) => void,
) {
  const held = new Map<GbaButton, Set<string>>()
  return {
    press(source: string, button: GbaButton) {
      const sources = held.get(button) || new Set<string>()
      if (sources.has(source)) return
      if (!sources.size) press(button)
      sources.add(source)
      held.set(button, sources)
    },
    release(source: string, button: GbaButton) {
      const sources = held.get(button)
      if (!sources?.delete(source)) return
      if (!sources.size) {
        held.delete(button)
        release(button)
      }
    },
    clear(source?: string) {
      for (const [button, sources] of held) {
        if (source) sources.delete(source)
        else sources.clear()
        if (!sources.size) {
          held.delete(button)
          release(button)
        }
      }
    },
  }
}
