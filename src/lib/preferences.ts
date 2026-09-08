import type { GbaButton } from '../emulator'

export type Settings = {
  volume: number
  speed: 1 | 2 | 4
  filter: 'pixel' | 'smooth' | 'crt'
  autoSave: boolean
  touch: boolean
  bindings: Record<GbaButton, string>
}
export const defaultBindings: Record<GbaButton, string> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  A: 'KeyX',
  B: 'KeyZ',
  L: 'KeyA',
  R: 'KeyS',
  Start: 'Enter',
  Select: 'ShiftRight',
}
export const defaultSettings: Settings = {
  volume: 0.65,
  speed: 1,
  filter: 'pixel',
  autoSave: true,
  touch: false,
  bindings: defaultBindings,
}
export function readSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem('advance.settings') || '{}')
    return {
      volume: typeof raw.volume === 'number' ? Math.max(0, Math.min(1, raw.volume)) : 0.65,
      speed: [1, 2, 4].includes(raw.speed) ? raw.speed : 1,
      filter: ['pixel', 'smooth', 'crt'].includes(raw.filter) ? raw.filter : 'pixel',
      autoSave: raw.autoSave !== false,
      touch: raw.touch === true,
      bindings: {
        ...defaultBindings,
        ...Object.fromEntries(
          Object.entries(raw.bindings || {}).filter(
            ([k, v]) => k in defaultBindings && typeof v === 'string',
          ),
        ),
      },
    }
  } catch {
    return defaultSettings
  }
}
export function keyLabel(code: string) {
  return (
    (
      {
        ArrowUp: '↑',
        ArrowDown: '↓',
        ArrowLeft: '←',
        ArrowRight: '→',
        Enter: 'Enter',
        ShiftRight: 'R Shift',
        ShiftLeft: 'L Shift',
        Space: 'Space',
      } as Record<string, string>
    )[code] || code.replace(/^Key|^Digit/, '')
  )
}
