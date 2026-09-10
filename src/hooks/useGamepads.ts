import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GbaButton } from '../emulator'
import {
  GAMEPAD_STORAGE_KEY,
  advanceGamepadCapture,
  aggregateGamepadButtons,
  assignGamepadBinding,
  beginGamepadCapture,
  bindingLabel,
  decodeGamepadProfiles,
  defaultGamepadProfile,
  diffGamepadButtons,
  gamepadProfileKey,
  validateGamepadProfile,
} from '../lib/gamepad'
import type { GamepadCapture, GamepadProfile, GamepadSnapshot } from '../lib/gamepad'

export interface ConnectedGamepad {
  index: number
  id: string
  profileKey: string
  standard: boolean
  buttonCount: number
  axisCount: number
}

interface CaptureSession {
  index: number
  profileKey: string
  target: GbaButton
  state: GamepadCapture
}

export interface GamepadController {
  connected: boolean
  devices: ConnectedGamepad[]
  selectedDevice: ConnectedGamepad | null
  profile: GamepadProfile | null
  capture: GbaButton | null
  error: string | null
  storageError: string | null
  message: string | null
  selectDevice: (index: number) => void
  startCapture: (target: GbaButton) => void
  cancelCapture: () => void
  clearBinding: (target: GbaButton) => void
  setDeadzone: (value: number) => void
  reset: () => void
}

export function useGamepads(options: {
  enabled: boolean
  onPress: (button: GbaButton) => void
  onRelease: (button: GbaButton) => void
}): GamepadController {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [devices, setDevices] = useState<ConnectedGamepad[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const selectedRef = useRef<number | null>(null)
  const [capture, setCapture] = useState<GbaButton | null>(null)
  const captureRef = useRef<CaptureSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [, setRevision] = useState(0)
  const padsRef = useRef<GamepadSnapshot[]>([])
  const profilesRef = useRef(new Map<string, GamepadProfile>())
  const savedRef = useRef<Record<string, unknown>>({})
  const emittedRef = useRef(new Set<GbaButton>())

  const emitButtons = useCallback((next: Set<GbaButton>) => {
    const changes = diffGamepadButtons(emittedRef.current, next)
    emittedRef.current = next
    for (const key of changes.released) optionsRef.current.onRelease(key)
    for (const key of changes.pressed) optionsRef.current.onPress(key)
  }, [])
  const releaseAll = useCallback(() => emitButtons(new Set()), [emitButtons])

  const cancelCapture = useCallback(() => {
    captureRef.current = null
    setCapture(null)
  }, [])

  const profileFor = useCallback((pad: GamepadSnapshot) => {
    const key = gamepadProfileKey(pad)
    let profile = profilesRef.current.get(key)
    if (!profile) {
      profile = validateGamepadProfile(savedRef.current[key], pad) ?? defaultGamepadProfile(pad)
      profilesRef.current.set(key, profile)
    }
    return profile
  }, [])

  const saveProfile = useCallback(
    (pad: GamepadSnapshot, profile: GamepadProfile) => {
      releaseAll()
      const key = gamepadProfileKey(pad)
      profilesRef.current.set(key, profile)
      savedRef.current = { ...savedRef.current, [key]: profile }
      setRevision((revision) => revision + 1)
      try {
        localStorage.setItem(
          GAMEPAD_STORAGE_KEY,
          JSON.stringify({ version: 1, profiles: savedRef.current }),
        )
        setStorageError(null)
      } catch {
        setStorageError('浏览器无法保存手柄设置；本次页面内仍然有效。')
      }
    },
    [releaseAll],
  )

  const selectedPad = useCallback(
    () => padsRef.current.find((pad) => pad.index === selectedRef.current),
    [],
  )

  const selectDevice = useCallback(
    (index: number) => {
      if (!padsRef.current.some((pad) => pad.index === index)) return
      cancelCapture()
      selectedRef.current = index
      setSelectedIndex(index)
      setMessage(null)
    },
    [cancelCapture],
  )

  const startCapture = useCallback(
    (target: GbaButton) => {
      const pad = selectedPad()
      if (!pad) return
      releaseAll()
      captureRef.current = {
        index: pad.index,
        profileKey: gamepadProfileKey(pad),
        target,
        state: beginGamepadCapture(pad, profileFor(pad).deadzone),
      }
      setCapture(target)
      setMessage(null)
    },
    [selectedPad, releaseAll, profileFor],
  )

  const clearBinding = useCallback(
    (target: GbaButton) => {
      const pad = selectedPad()
      if (!pad) return
      cancelCapture()
      const profile = profileFor(pad)
      saveProfile(pad, { ...profile, bindings: { ...profile.bindings, [target]: [] } })
      setMessage(`${target} 已取消映射。`)
    },
    [selectedPad, cancelCapture, profileFor, saveProfile],
  )

  const setDeadzone = useCallback(
    (value: number) => {
      const pad = selectedPad()
      if (!pad || !Number.isFinite(value)) return
      cancelCapture()
      saveProfile(pad, { ...profileFor(pad), deadzone: Math.max(0.1, Math.min(0.9, value)) })
    },
    [selectedPad, cancelCapture, profileFor, saveProfile],
  )

  const reset = useCallback(() => {
    const pad = selectedPad()
    if (!pad) return
    cancelCapture()
    saveProfile(pad, defaultGamepadProfile(pad))
    setMessage(
      pad.mapping === 'standard'
        ? '已恢复标准手柄默认映射和死区。'
        : '已清空自定义映射并恢复默认死区。',
    )
  }, [selectedPad, cancelCapture, saveProfile])

  useLayoutEffect(() => {
    if (!options.enabled) releaseAll()
  }, [options.enabled, releaseAll])

  useEffect(() => {
    try {
      savedRef.current = decodeGamepadProfiles(localStorage.getItem(GAMEPAD_STORAGE_KEY))
    } catch {
      setStorageError('浏览器无法读取手柄设置；可以临时配置本次页面。')
    }
    let frame = 0
    let lastDevices = ''
    let retryAt = 0
    const poll = (now: number) => {
      let pads: GamepadSnapshot[] = []
      if (now >= retryAt) {
        try {
          if (typeof navigator.getGamepads !== 'function') {
            setError('当前浏览器不支持 Gamepad API，请使用键盘或触控。')
            retryAt = now + 1000
          } else {
            pads = Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad =>
              Boolean(pad?.connected),
            )
            setError(null)
          }
        } catch {
          setError('浏览器禁止访问手柄，请在允许 Gamepad API 的安全页面中重试。')
          retryAt = now + 1000
        }
      }
      padsRef.current = pads
      const nextDevices = pads.map((pad) => ({
        index: pad.index,
        id: pad.id,
        profileKey: gamepadProfileKey(pad),
        standard: pad.mapping === 'standard',
        buttonCount: pad.buttons.length,
        axisCount: pad.axes.length,
      }))
      const signature = JSON.stringify(nextDevices)
      if (signature !== lastDevices) {
        lastDevices = signature
        pads.forEach(profileFor)
        setDevices(nextDevices)
        if (!pads.some((pad) => pad.index === selectedRef.current)) {
          selectedRef.current = pads[0]?.index ?? null
          setSelectedIndex(selectedRef.current)
        }
      }

      const focused = !document.hidden && document.hasFocus()
      const session = captureRef.current
      if (session) {
        const pad = pads.find(
          (item) => item.index === session.index && gamepadProfileKey(item) === session.profileKey,
        )
        if (!pad || !focused) {
          cancelCapture()
          setMessage(!pad ? '手柄已断开，映射已取消。' : '页面失去焦点，映射已取消。')
        } else {
          const profile = profileFor(pad)
          const result = advanceGamepadCapture(pad, session.state, profile.deadzone)
          session.state = result.capture
          if (result.binding) {
            const assigned = assignGamepadBinding(profile, session.target, result.binding)
            saveProfile(pad, assigned.profile)
            cancelCapture()
            setMessage(
              `${session.target} 已映射为${bindingLabel(result.binding)}。${
                assigned.displaced.length
                  ? `已移除 ${assigned.displaced.join('、')} 的同一输入映射。`
                  : ''
              }`,
            )
          }
        }
      }

      const next =
        optionsRef.current.enabled && focused && !captureRef.current
          ? aggregateGamepadButtons(pads.map((pad) => ({ pad, profile: profileFor(pad) })))
          : new Set<GbaButton>()
      emitButtons(next)
      frame = requestAnimationFrame(poll)
    }
    const loseFocus = () => {
      releaseAll()
      if (captureRef.current) {
        cancelCapture()
        setMessage('页面失去焦点，映射已取消。')
      }
    }
    const visibilityChange = () => {
      if (document.hidden) loseFocus()
    }
    const disconnected = (event: GamepadEvent) => {
      // Release immediately even when requestAnimationFrame is suspended in the background.
      padsRef.current = padsRef.current.filter((pad) => pad.index !== event.gamepad.index)
      const next =
        optionsRef.current.enabled && !document.hidden && document.hasFocus() && !captureRef.current
          ? aggregateGamepadButtons(
              padsRef.current.map((pad) => ({ pad, profile: profileFor(pad) })),
            )
          : new Set<GbaButton>()
      emitButtons(next)
      if (captureRef.current?.index === event.gamepad.index) {
        cancelCapture()
        setMessage('手柄已断开，映射已取消。')
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.code !== 'Escape' || !captureRef.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelCapture()
      setMessage('已取消映射。')
    }
    frame = requestAnimationFrame(poll)
    window.addEventListener('blur', loseFocus)
    document.addEventListener('visibilitychange', visibilityChange)
    window.addEventListener('gamepaddisconnected', disconnected)
    window.addEventListener('keydown', escape, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('blur', loseFocus)
      document.removeEventListener('visibilitychange', visibilityChange)
      window.removeEventListener('gamepaddisconnected', disconnected)
      window.removeEventListener('keydown', escape, true)
      releaseAll()
      captureRef.current = null
    }
  }, [cancelCapture, emitButtons, profileFor, releaseAll, saveProfile])

  const selectedDevice = devices.find((device) => device.index === selectedIndex) ?? null
  return {
    connected: devices.length > 0,
    devices,
    selectedDevice,
    profile: selectedDevice ? (profilesRef.current.get(selectedDevice.profileKey) ?? null) : null,
    capture,
    error,
    storageError,
    message,
    selectDevice,
    startCapture,
    cancelCapture,
    clearBinding,
    setDeadzone,
    reset,
  }
}
