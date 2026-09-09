import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudOff,
  Download,
  Expand,
  FastForward,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Heart,
  Keyboard,
  LayoutGrid,
  List,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { HandheldArt, SpaceArt } from './components/Artwork'
import { createEmulator } from './emulator'
import type { EmulatorStatus, GbaButton, GbaEmulator } from './emulator'
import * as db from './lib/storage'
import { extractRomFiles } from './lib/import-roms'
import type { Game, SaveState } from './lib/types'
import { defaultBindings, keyLabel, readSettings } from './lib/preferences'
import type { Settings } from './lib/preferences'
import { probeCompatibility } from './lib/compatibility'
import type { CompatibilityReport } from './lib/compatibility'

type Page = 'library' | 'recent' | 'favorites' | 'states'
type Modal = 'settings' | 'controls' | 'help' | 'states' | null
const pages: Record<Page, string> = {
  library: '游戏库',
  recent: '最近游玩',
  favorites: '我的收藏',
  states: '存档管理',
}
const buttonNames: Record<GbaButton, string> = {
  Up: '上',
  Down: '下',
  Left: '左',
  Right: '右',
  A: 'A 按钮',
  B: 'B 按钮',
  L: 'L 肩键',
  R: 'R 肩键',
  Start: '开始',
  Select: '选择',
}
const formatTime = (seconds: number) =>
  seconds < 60
    ? '刚刚开始'
    : seconds < 3600
      ? `${Math.floor(seconds / 60)} 分钟`
      : `${(seconds / 3600).toFixed(1)} 小时`
const formatDate = (time: number) =>
  new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
const formatSize = (bytes: number) =>
  bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`
const isDemo = (game: Game) => game.filename === 'star-orbit.gba'
const displayTitle = (game: Game) => (isDemo(game) ? 'Star Orbit · 星际漫游' : game.title)

function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  className = '',
}: {
  children: ReactNode
  label: string
  onClick?: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function download(data: Blob | Uint8Array, name: string) {
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data)])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const [games, setGames] = useState<Game[]>([])
  const [page, setPage] = useState<Page>('library')
  const [active, setActive] = useState<Game | null>(null)
  const [status, setStatus] = useState<EmulatorStatus>('idle')
  const [settings, setSettings] = useState<Settings>(readSettings)
  const [modal, setModal] = useState<Modal>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('recent')
  const [layout, setLayout] = useState('grid')
  const [busy, setBusy] = useState(false)
  const [importLabel, setImportLabel] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState('正在准备模拟器…')
  const [compatibility, setCompatibility] = useState<CompatibilityReport | null>(null)
  const [compatibilityOpen, setCompatibilityOpen] = useState(false)
  const [fps, setFps] = useState(0)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [states, setStates] = useState<SaveState[]>([])
  const [allStates, setAllStates] = useState<SaveState[]>([])
  const [mapping, setMapping] = useState<GbaButton | null>(null)
  const [gamepad, setGamepad] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [gameMenu, setGameMenu] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Game | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLElement>(null)
  const engineRef = useRef<GbaEmulator | null>(null)
  const activeRef = useRef<Game | null>(null)
  const settingsRef = useRef(settings)
  const operationRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)
  const stateInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const dragCount = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const notify = useCallback((text: string, error = false) => {
    clearTimeout(toastTimer.current)
    setToast({ text, error })
    toastTimer.current = setTimeout(() => setToast(null), error ? 7000 : 3500)
  }, [])
  const refresh = useCallback(async () => setGames(await db.getGames()), [])
  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (operationRef.current) return
      operationRef.current = true
      setBusy(true)
      try {
        await action()
      } catch (error) {
        notify(error instanceof Error ? error.message : '操作失败，请重试', true)
      } finally {
        operationRef.current = false
        setBusy(false)
      }
    },
    [notify],
  )

  useEffect(() => {
    let cancelled = false
    void probeCompatibility()
      .then((report) => {
        if (!cancelled) setCompatibility(report)
      })
      .catch(() => {
        if (!cancelled) notify('环境检查暂时无法完成，请刷新后重试', true)
      })
    return () => {
      cancelled = true
    }
  }, [notify])

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        let list = await db.getGames()
        if (!list.some(isDemo)) {
          const response = await fetch('/demo/star-orbit.gba')
          if (!response.ok) throw new Error('试玩游戏暂时不可用，你仍可导入自己的 .gba 游戏')
          await db.importGame(new File([await response.arrayBuffer()], 'star-orbit.gba'))
          list = await db.getGames()
        }
        if (!cancelled) setGames(list)
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : '无法读取游戏库', true)
      } finally {
        if (!cancelled) setReady(true)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [notify])

  useEffect(() => {
    if (!canvasRef.current) return
    const engine = createEmulator(canvasRef.current, {
      onStatus: setStatus,
      onFps: setFps,
      onProgress: setProgress,
      onError: (error) => notify(error.message, true),
      onSaveChange: (bytes) => {
        const game = activeRef.current
        if (game)
          void db
            .setBatterySave(game.id, bytes)
            .catch(() => notify('游戏内存档写入失败，请导出备份', true))
      },
    })
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [notify])

  useEffect(() => {
    settingsRef.current = settings
    try {
      localStorage.setItem('advance.settings', JSON.stringify(settings))
    } catch {
      notify('设置无法持久保存：本地存储空间不足', true)
    }
    engineRef.current?.setVolume(settings.volume)
    engineRef.current?.setSpeed(settings.speed)
  }, [settings, notify])

  const snapshot = useCallback(
    async (slot: number, silent = false) => {
      const game = activeRef.current,
        engine = engineRef.current
      if (!game || !engine || !['running', 'paused'].includes(engine.status)) return
      const data = await engine.saveState()
      let screenshot: string | undefined
      try {
        const blob = await engine.screenshot()
        screenshot = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
      } catch {
        /* Save data remains useful without a thumbnail. */
      }
      await db.saveState(game.id, slot, data, screenshot)
      setStates(await db.getStates(game.id))
      if (!silent) notify(slot === 0 ? '自动存档已更新' : `已保存到存档位 ${slot}`)
    },
    [notify],
  )

  useEffect(() => {
    if (!active || status !== 'running') return
    let lastTick = Date.now()
    const tick = async () => {
      const now = Date.now(),
        elapsed = Math.floor((now - lastTick) / 1000)
      lastTick = now
      if (elapsed < 1) return
      try {
        const current = (await db.getGames()).find((g) => g.id === active.id)
        if (current) {
          await db.updateGame(active.id, { playTime: current.playTime + elapsed })
          await refresh()
        }
      } catch {
        /* Report explicit save failures through the save controls. */
      }
    }
    const timer = setInterval(() => {
      void tick()
    }, 15000)
    return () => {
      clearInterval(timer)
      void tick()
    }
  }, [active, status, refresh])

  useEffect(() => {
    if (!active || !settings.autoSave || status !== 'running') return
    const timer = setInterval(() => {
      if (!operationRef.current) void run(() => snapshot(0, true))
    }, 30000)
    return () => clearInterval(timer)
  }, [active, status, settings.autoSave, run, snapshot])

  useEffect(() => {
    const release = () => {
      engineRef.current?.releaseAllKeys()
      engineRef.current?.setSpeed(settingsRef.current.speed)
    }
    const visibility = () => {
      if (document.hidden) {
        release()
        if (engineRef.current?.status === 'running') {
          engineRef.current.pause()
          if (settingsRef.current.autoSave && !operationRef.current)
            void run(() => snapshot(0, true))
        }
      }
    }
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [run, snapshot])

  useEffect(() => {
    if (page === 'states')
      void Promise.all(games.map((game) => db.getStates(game.id)))
        .then((result) => setAllStates(result.flat()))
        .catch(() => notify('无法读取存档', true))
  }, [page, games, states, notify])

  useEffect(() => {
    if (!modal && !deleteTarget) return
    engineRef.current?.releaseAllKeys()
    const previous = document.activeElement as HTMLElement | null
    const first = modalRef.current?.querySelector<HTMLElement>('button, input, select')
    first?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !mapping) {
        setModal(null)
        setDeleteTarget(null)
      }
      if (event.key !== 'Tab') return
      const elements = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select, [tabindex="0"]',
        ) || [],
      )
      if (!elements.length) return
      const first = elements[0],
        last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      previous?.focus()
    }
  }, [modal, deleteTarget, mapping])

  const playGame = useCallback(
    (game: Game, requestedState?: SaveState) =>
      run(async () => {
        const engine = engineRef.current
        if (!engine) throw new Error('模拟器尚未就绪')
        if (activeRef.current && ['running', 'paused'].includes(engine.status)) {
          engine.pause()
          if (settingsRef.current.autoSave) await snapshot(0, true)
          const battery = await engine.exportSave()
          if (battery) await db.setBatterySave(activeRef.current.id, battery)
        }
        const bytes = await db.getRom(game.id)
        if (!bytes) throw new Error('游戏文件未找到，请重新导入')
        const battery = await db.getBatterySave(game.id)
        const resume =
          requestedState ||
          (settingsRef.current.autoSave ? await db.getState(game.id, 0) : undefined)
        activeRef.current = game
        setActive(game)
        setPage('library')
        setModal(null)
        setProgress('正在启动 mGBA 内核…')
        await engine.loadRom(bytes, game.filename)
        if (battery) await engine.importSave(battery)
        engine.setVolume(settingsRef.current.volume)
        engine.setSpeed(settingsRef.current.speed)
        if (resume) {
          try {
            await engine.loadState(resume.data)
            notify('已从存档继续游戏')
          } catch {
            notify('此即时存档无法恢复，已重新启动游戏', true)
          }
        }
        await db.updateGame(game.id, { lastPlayed: Date.now() })
        setStates(await db.getStates(game.id))
        await refresh()
        canvasRef.current?.focus({ preventScroll: true })
        stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }),
    [run, snapshot, notify, refresh],
  )

  const closeGame = () =>
    run(async () => {
      const engine = engineRef.current,
        game = activeRef.current
      if (game && engine && ['running', 'paused'].includes(engine.status)) {
        engine.pause()
        if (settings.autoSave) await snapshot(0, true)
        const battery = await engine.exportSave()
        if (battery) await db.setBatterySave(game.id, battery)
        engine.pause()
        engine.releaseAllKeys()
      }
      activeRef.current = null
      setActive(null)
      setStates([])
      await refresh()
      notify('已返回游戏库')
    })

  const loadSlot = (slot: number) =>
    run(async () => {
      if (!activeRef.current) return
      const state = await db.getState(activeRef.current.id, slot)
      if (!state) throw new Error('此存档位还没有存档')
      await engineRef.current?.loadState(state.data)
      notify('已恢复存档')
      setModal(null)
    })
  const togglePause = () => {
    const engine = engineRef.current
    if (!engine || !activeRef.current || operationRef.current) return
    if (engine.status === 'running') engine.pause()
    else if (engine.status === 'paused') engine.resume()
    canvasRef.current?.focus({ preventScroll: true })
  }
  const screenshot = () =>
    run(async () => {
      if (!activeRef.current || !engineRef.current) return
      download(await engineRef.current.screenshot(), `${activeRef.current.title}-${Date.now()}.png`)
      notify('截图已下载')
    })
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await stageRef.current?.requestFullscreen()
    } catch {
      notify('当前浏览器不支持全屏模式', true)
    }
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (mapping) {
        event.preventDefault()
        if (event.code === 'Escape') {
          setMapping(null)
          return
        }
        if (['Space', 'Tab', 'F5', 'F8', 'F11', 'Backspace'].includes(event.code)) {
          notify('这个按键用于模拟器快捷操作，请选择其他按键')
          return
        }
        const existing = Object.entries(settings.bindings).find(
          ([key, code]) => key !== mapping && code === event.code,
        )
        if (existing) {
          notify(`此按键已用于「${buttonNames[existing[0] as GbaButton]}」`)
          return
        }
        setSettings((value) => ({
          ...value,
          bindings: { ...value.bindings, [mapping]: event.code },
        }))
        setMapping(null)
        return
      }
      if (
        modal ||
        deleteTarget ||
        !activeRef.current ||
        (event.target instanceof HTMLElement &&
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) ||
            event.target.isContentEditable))
      )
        return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Gameplay shortcuts own the focused screen; the rest of the interface
      // keeps normal Tab navigation and Enter/Space button activation.
      if (document.activeElement !== canvasRef.current) return
      if (event.code === 'Escape') {
        engineRef.current?.releaseAllKeys()
        canvasRef.current?.blur()
        return
      }
      if (event.code === 'Tab' && event.shiftKey) return
      const button = (Object.entries(settings.bindings) as [GbaButton, string][]).find(
        ([, code]) => code === event.code,
      )?.[0]
      if (button) {
        event.preventDefault()
        if (!event.repeat) engineRef.current?.keyDown(button)
        return
      }
      if (['Space', 'F5', 'F8', 'Tab', 'F11', 'Backspace'].includes(event.code))
        event.preventDefault()
      if (event.repeat) return
      if (event.code === 'Space') togglePause()
      if (event.code === 'F5') void run(() => snapshot(1))
      if (event.code === 'F8') void loadSlot(1)
      if (event.code === 'Tab') engineRef.current?.setSpeed(2)
      if (event.code === 'Backspace') engineRef.current?.setRewind(true)
      if (event.code === 'F11') void fullscreen()
    }
    const keyup = (event: KeyboardEvent) => {
      const button = (Object.entries(settings.bindings) as [GbaButton, string][]).find(
        ([, code]) => code === event.code,
      )?.[0]
      if (button) engineRef.current?.keyUp(button)
      if (event.code === 'Tab') engineRef.current?.setSpeed(settings.speed)
      if (event.code === 'Backspace') engineRef.current?.setRewind(false)
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    }
  })

  useEffect(() => {
    let frame = 0,
      previous = new Set<GbaButton>()
    const poll = () => {
      const pads = navigator.getGamepads?.() || []
      const pad = Array.from(pads).find((p) => p?.connected && p.mapping === 'standard')
      setGamepad(Boolean(pad))
      const next = new Set<GbaButton>()
      if (
        pad &&
        activeRef.current &&
        engineRef.current?.status === 'running' &&
        !document.hidden &&
        document.hasFocus() &&
        !modal &&
        !deleteTarget
      ) {
        const mapping: [number, GbaButton][] = [
          [0, 'A'],
          [1, 'B'],
          [4, 'L'],
          [5, 'R'],
          [8, 'Select'],
          [9, 'Start'],
          [12, 'Up'],
          [13, 'Down'],
          [14, 'Left'],
          [15, 'Right'],
        ]
        mapping.forEach(([index, key]) => {
          if (pad.buttons[index]?.pressed) next.add(key)
        })
        if (pad.axes[0] < -0.45) next.add('Left')
        if (pad.axes[0] > 0.45) next.add('Right')
        if (pad.axes[1] < -0.45) next.add('Up')
        if (pad.axes[1] > 0.45) next.add('Down')
      }
      for (const key of next) if (!previous.has(key)) engineRef.current?.keyDown(key)
      for (const key of previous) if (!next.has(key)) engineRef.current?.keyUp(key)
      previous = next
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => {
      cancelAnimationFrame(frame)
      previous.forEach((key) => engineRef.current?.keyUp(key))
    }
  }, [modal, deleteTarget])

  const importFiles = (files: File[]) =>
    run(async () => {
      if (!files.length) return
      let imported = 0
      let duplicates = 0
      const errors: string[] = []
      const known = new Set((await db.getGames()).map((game) => game.id))
      try {
        for (const file of files) {
          setImportLabel(/\.zip$/i.test(file.name) ? '正在解压…' : '正在导入…')
          try {
            for await (const rom of extractRomFiles(file)) {
              try {
                const game = await db.importGame(rom)
                if (known.has(game.id)) duplicates++
                else {
                  known.add(game.id)
                  imported++
                }
              } catch (error) {
                errors.push(`${rom.name}：${error instanceof Error ? error.message : '导入失败'}`)
              }
            }
          } catch (error) {
            errors.push(`${file.name}：${error instanceof Error ? error.message : '导入失败'}`)
          }
        }
        await refresh()
        setPage('library')
        const result = [
          imported ? `已导入 ${imported} 个游戏` : '',
          duplicates ? `${duplicates} 个重复游戏已合并` : '',
        ]
          .filter(Boolean)
          .join('；')
        const failure =
          errors.slice(0, 3).join('；') +
          (errors.length > 3 ? `；另有 ${errors.length - 3} 项失败` : '')
        notify(
          errors.length
            ? [result, failure].filter(Boolean).join('；')
            : duplicates
              ? result
              : `${result}，准备开始吧`,
          errors.length > 0,
        )
      } finally {
        setImportLabel(null)
      }
    })
  const favorite = async (game: Game) => {
    try {
      await db.updateGame(game.id, { favorite: !game.favorite })
      await refresh()
      setGameMenu(null)
    } catch {
      notify('收藏更新失败', true)
    }
  }
  const deleteGame = () =>
    run(async () => {
      if (!deleteTarget) return
      await db.deleteGame(deleteTarget.id)
      setDeleteTarget(null)
      setGameMenu(null)
      await refresh()
      notify('游戏及其存档已删除')
    })
  const exportBattery = () =>
    run(async () => {
      const game = activeRef.current
      if (!game) return
      const bytes = (await engineRef.current?.exportSave()) || (await db.getBatterySave(game.id))
      if (!bytes?.length) throw new Error('此游戏尚未生成游戏内存档。你可以先创建即时存档。')
      download(bytes, game.filename.replace(/\.gba$/i, '.sav'))
      notify('游戏内存档已导出')
    })
  const importBattery = (file?: File) =>
    run(async () => {
      const game = activeRef.current
      if (!file || !game) return
      if (!/\.sav$/i.test(file.name) || file.size < 1 || file.size > 1048576)
        throw new Error('请选择有效的 .sav 存档文件（最大 1 MB）')
      const bytes = new Uint8Array(await file.arrayBuffer())
      await engineRef.current?.importSave(bytes)
      await db.setBatterySave(game.id, bytes)
      await snapshot(0, true)
      notify('存档已导入，游戏已重新启动')
    })
  const importSnapshot = (file?: File) =>
    run(async () => {
      if (!file || !activeRef.current) return
      if (!/\.ss[0-9]?$|\.state$/i.test(file.name) || file.size < 1 || file.size > 16777216)
        throw new Error('请选择 mGBA 即时存档（.state / .ss0，最大 16 MB）')
      await engineRef.current?.loadState(new Uint8Array(await file.arrayBuffer()))
      notify('即时存档已恢复')
      setModal(null)
    })

  const visibleGames = useMemo(
    () =>
      games
        .filter(
          (game) =>
            (page !== 'favorites' || game.favorite) &&
            (page !== 'recent' || game.lastPlayed) &&
            displayTitle(game).toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) =>
          sort === 'name'
            ? displayTitle(a).localeCompare(displayTitle(b), 'zh-CN')
            : sort === 'added'
              ? b.addedAt - a.addedAt
              : (b.lastPlayed || 0) - (a.lastPlayed || 0) || b.addedAt - a.addedAt,
        ),
    [games, page, search, sort],
  )
  const demo = games.find(isDemo)
  const canControl = Boolean(active && ['running', 'paused'].includes(status) && !busy)
  const setSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((previous) => ({ ...previous, [key]: value }))
  const navigate = (next: Page) => {
    setPage(next)
    setSearch('')
    setSidebarOpen(false)
  }
  const touchButton = (key: GbaButton, className = '') => (
    <button
      className={`touch-key ${className}`}
      aria-label={buttonNames[key]}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        engineRef.current?.keyDown(key)
      }}
      onPointerUp={() => engineRef.current?.keyUp(key)}
      onPointerCancel={() => engineRef.current?.keyUp(key)}
      onLostPointerCapture={() => engineRef.current?.keyUp(key)}
    >
      {key === 'Up'
        ? '↑'
        : key === 'Down'
          ? '↓'
          : key === 'Left'
            ? '←'
            : key === 'Right'
              ? '→'
              : key}
    </button>
  )

  return (
    <div
      className="app-shell"
      onDragEnter={(event) => {
        event.preventDefault()
        if (event.dataTransfer.types.includes('Files')) {
          dragCount.current++
          setDragging(true)
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault()
        if (--dragCount.current <= 0) {
          dragCount.current = 0
          setDragging(false)
        }
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragCount.current = 0
        setDragging(false)
        void importFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".gba,.zip"
        multiple
        hidden
        onChange={(event) => {
          void importFiles(Array.from(event.target.files || []))
          event.target.value = ''
        }}
      />
      <input
        ref={saveInputRef}
        type="file"
        accept=".sav"
        hidden
        onChange={(event) => {
          void importBattery(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <input
        ref={stateInputRef}
        type="file"
        accept=".state,.ss0,.ss1,.ss2,.ss3,.ss4,.ss5,.ss6,.ss7,.ss8,.ss9"
        hidden
        onChange={(event) => {
          void importSnapshot(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <a
          href="#"
          className="brand"
          onClick={(event) => {
            event.preventDefault()
            navigate('library')
          }}
        >
          <span className="brand-mark">
            <Plus strokeWidth={4} />
          </span>
          <span>
            advance<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace-label">
          你的掌机游戏空间 <span>BETA</span>
        </div>
        <div className="nav-group-title">工作台</div>
        <nav aria-label="主导航">
          {(
            [
              ['library', LayoutGrid],
              ['recent', Clock3],
              ['favorites', Heart],
              ['states', Save],
            ] as const
          ).map(([key, Icon]) => (
            <button
              key={key}
              className={`nav-item ${page === key ? 'active' : ''}`}
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              <span>{pages[key]}</span>
              {key === 'library' && <span className="nav-count">{games.length}</span>}
              {key === 'favorites' && games.some((g) => g.favorite) && (
                <span className="nav-count">{games.filter((g) => g.favorite).length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-group-title second">偏好设置</div>
        <nav aria-label="偏好设置">
          <button
            className="nav-item"
            onClick={() => {
              setModal('controls')
              setSidebarOpen(false)
            }}
          >
            <Gamepad2 size={18} />
            <span>控制器设置</span>
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setModal('settings')
              setSidebarOpen(false)
            }}
          >
            <SlidersHorizontal size={18} />
            <span>模拟器设置</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <div className="local-note-icon">
              <ShieldCheck size={19} />
            </div>
            <strong>只属于你的游戏时光</strong>
            <p>
              游戏与存档保存在此设备，
              <br />
              无需账号，随时开始。
            </p>
            <span>
              <span className="status-dot" />
              本地运行 · 隐私优先
            </span>
          </div>
          <button className="help-link" onClick={() => setModal('help')}>
            <CircleHelp size={17} />
            <span>帮助与快捷键</span>
            <span className="version">v1.0</span>
          </button>
          <div className="sidebar-footer">
            <span className="avatar">P</span>
            <div>
              <strong>Player One</strong>
              <small>今天也要玩得开心</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              label="打开导航"
              className="mobile-menu"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={20} />
            </IconButton>
            <span>工作台</span>
            <ChevronRight size={13} />
            <strong>{pages[page]}</strong>
          </div>
          <div className="topbar-right">
            <button
              className={`environment-button ${compatibility ? (compatibility.ready ? 'ready' : 'warning') : 'pending'}`}
              onClick={() => setCompatibilityOpen((open) => !open)}
              aria-expanded={compatibilityOpen}
              aria-controls="compatibility-panel"
              aria-label="环境检查"
              title="环境检查"
              disabled={!compatibility}
            >
              {compatibility ? (
                compatibility.ready ? (
                  <ShieldCheck size={16} />
                ) : (
                  <CloudOff size={16} />
                )
              ) : (
                <LoaderCircle className="spin" size={16} />
              )}
              <span>{compatibility ? '环境检查' : '检查环境…'}</span>
            </button>
            <span className="topbar-divider" />
            <span className={`connection ${gamepad ? 'connected' : ''}`}>
              <Gamepad2 size={16} />
              {gamepad ? '手柄已连接' : '键盘已就绪'}
            </span>
            <span className="topbar-divider" />
            <button className="shortcut-button" onClick={() => setModal('help')}>
              <Keyboard size={17} />
              <span>快捷键</span>
            </button>
          </div>
        </header>
        {compatibilityOpen && compatibility && (
          <section
            className="compatibility-panel"
            id="compatibility-panel"
            aria-label="运行环境检查"
          >
            <div className="compatibility-heading">
              <div>
                <strong>运行环境检查</strong>
                <p>
                  {compatibility.ready
                    ? '模拟器运行所需能力已就绪。'
                    : '有能力未满足，可能导致核心无法启动。'}
                </p>
              </div>
              <button
                className="icon-button"
                aria-label="关闭环境检查"
                onClick={() => setCompatibilityOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="compatibility-grid">
              {compatibility.checks.map((check) => (
                <div className={`compatibility-check ${check.status}`} key={check.id}>
                  <span className="compatibility-mark" aria-hidden="true">
                    {check.status === 'ok' ? (
                      <Check size={14} />
                    ) : check.status === 'warning' ? (
                      '!'
                    ) : (
                      <X size={14} />
                    )}
                  </span>
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                    {check.action && <small>{check.action}</small>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR NEXT ADVENTURE AWAITS</div>
              <h1>
                {pages[page]}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {page === 'library'
                  ? '熟悉的像素，随时开启的新冒险。'
                  : page === 'recent'
                    ? '接着上次的冒险，继续向前。'
                    : page === 'favorites'
                      ? '把心头好，放在最顺手的地方。'
                      : '每一段冒险，都值得好好保存。'}
              </p>
            </div>
            <button
              className="button primary import-top"
              disabled={busy}
              aria-busy={Boolean(importLabel)}
              onClick={() => inputRef.current?.click()}
            >
              {importLabel ? <LoaderCircle className="spin" size={18} /> : <Plus size={18} />}
              {importLabel || '导入游戏'}
            </button>
          </div>

          <section
            ref={stageRef}
            className={`player-panel ${active ? 'visible' : ''}`}
            aria-label="GBA 游戏画面"
          >
            <div className="player-heading">
              <div>
                <span className={`status-dot ${status === 'running' ? '' : 'paused'}`} />
                <strong>{active ? displayTitle(active) : 'GBA'}</strong>
                <span className="pill">GAME BOY ADVANCE</span>
              </div>
              <IconButton label="返回游戏库" onClick={() => void closeGame()} disabled={busy}>
                <X size={18} />
              </IconButton>
            </div>
            <div className={`canvas-wrap filter-${settings.filter}`}>
              <canvas
                ref={canvasRef}
                width={240}
                height={160}
                tabIndex={0}
                aria-label="GBA 模拟器画面"
              />
              {active && status === 'loading' && (
                <div className="player-overlay loading-overlay">
                  <LoaderCircle className="spin" size={28} />
                  <span>{progress}</span>
                </div>
              )}
              {active && status === 'paused' && !busy && (
                <button className="player-overlay pause-overlay" onClick={togglePause}>
                  <span className="pause-round">
                    <Play size={27} fill="currentColor" />
                  </span>
                  <strong>游戏已暂停</strong>
                  <span>点击继续，或按空格键</span>
                </button>
              )}
              {active && status === 'error' && (
                <div className="player-overlay">
                  <CircleHelp size={28} />
                  <strong>游戏启动失败</strong>
                  <span>请检查游戏文件，或重新尝试</span>
                  <button className="button primary" onClick={() => void playGame(active)}>
                    重新启动
                  </button>
                </div>
              )}
            </div>
            <div className="player-toolbar">
              <div className="toolbar-group">
                <IconButton
                  label={status === 'running' ? '暂停 (Space)' : '继续 (Space)'}
                  disabled={!canControl}
                  onClick={togglePause}
                >
                  {status === 'running' ? <Pause size={19} /> : <Play size={19} />}
                </IconButton>
                <IconButton
                  label="重新开始游戏"
                  disabled={!canControl}
                  onClick={() =>
                    void run(async () => {
                      await engineRef.current?.reset()
                      notify('游戏已重新开始')
                    })
                  }
                >
                  <RotateCcw size={18} />
                </IconButton>
                <span className="toolbar-divider" />
                <IconButton
                  label="快速存档 (F5)"
                  disabled={!canControl}
                  onClick={() => void run(() => snapshot(1))}
                >
                  <Save size={18} />
                </IconButton>
                <IconButton
                  label="快速读档 (F8)"
                  disabled={!canControl || !states.some((s) => s.slot === 1)}
                  onClick={() => void loadSlot(1)}
                >
                  <FolderOpen size={18} />
                </IconButton>
                <IconButton
                  label="保存截图"
                  disabled={!canControl}
                  onClick={() => void screenshot()}
                >
                  <ScanLine size={18} />
                </IconButton>
              </div>
              <div className="toolbar-group">
                <button
                  className={`speed-button ${settings.speed !== 1 ? 'accelerated' : ''}`}
                  onClick={() =>
                    setSetting('speed', settings.speed === 1 ? 2 : settings.speed === 2 ? 4 : 1)
                  }
                  title="切换运行速度"
                >
                  <FastForward size={16} />
                  {settings.speed}×
                </button>
                <span className="fps">
                  <span className="status-dot" />
                  {status === 'running' ? fps : '—'} FPS
                </span>
                <IconButton
                  label={settings.volume ? '静音' : '取消静音'}
                  onClick={() => setSetting('volume', settings.volume ? 0 : 0.65)}
                >
                  {settings.volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </IconButton>
                <IconButton label="全屏 (F11)" onClick={() => void fullscreen()}>
                  <Expand size={18} />
                </IconButton>
              </div>
            </div>
            <div className={`touch-controls ${settings.touch ? 'force-touch' : ''}`}>
              <div className="touch-shoulders">
                {touchButton('L')}
                {touchButton('R')}
              </div>
              <div className="touch-main">
                <div className="touch-dpad">
                  {touchButton('Up', 'up')}
                  {touchButton('Left', 'left')}
                  {touchButton('Right', 'right')}
                  {touchButton('Down', 'down')}
                </div>
                <div className="touch-system">
                  {touchButton('Select')}
                  {touchButton('Start')}
                </div>
                <div className="touch-ab">
                  {touchButton('B')}
                  {touchButton('A')}
                </div>
              </div>
            </div>
          </section>

          {!active && page === 'library' && (
            <section className="hero">
              <div className="hero-content">
                <div className="hero-badge">
                  <span /> SMALL CONSOLE. BIG MEMORIES.
                </div>
                <h2>
                  经典像素，
                  <br />
                  <span>全新主场。</span>
                </h2>
                <p>
                  把口袋里的冒险，带回你的屏幕。
                  <br />
                  轻一点，回到热爱的那个世界。
                </p>
                <div className="hero-actions">
                  <button
                    className="button primary"
                    disabled={!demo || busy}
                    onClick={() => demo && void playGame(demo)}
                  >
                    <Play size={15} fill="currentColor" />
                    开始试玩
                    <ArrowRight size={16} />
                  </button>
                  <button className="button ghost" onClick={() => setModal('help')}>
                    了解更多
                    <ChevronRight size={15} />
                  </button>
                </div>
                <span className="hero-footnote">
                  <Sparkles size={12} />
                  内置原创游戏 · 无需下载 · 即点即玩
                </span>
              </div>
              <HandheldArt />
            </section>
          )}

          {page !== 'states' ? (
            <div className="content-grid">
              <section className="library-section">
                <div className="section-heading">
                  <div className="section-title">
                    <h2>{page === 'library' ? '我的游戏' : pages[page]}</h2>
                    <span className="count-badge">{visibleGames.length}</span>
                  </div>
                  <div className="view-toggle">
                    <IconButton
                      label="网格视图"
                      className={layout === 'grid' ? 'selected' : ''}
                      onClick={() => setLayout('grid')}
                    >
                      <LayoutGrid size={16} />
                    </IconButton>
                    <IconButton
                      label="列表视图"
                      className={layout === 'list' ? 'selected' : ''}
                      onClick={() => setLayout('list')}
                    >
                      <List size={17} />
                    </IconButton>
                  </div>
                </div>
                <div className="library-tools">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="搜索游戏"
                      placeholder="搜索你的游戏…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    {search && (
                      <button aria-label="清空搜索" onClick={() => setSearch('')}>
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <div className="sort-select">
                    <select
                      aria-label="游戏排序"
                      value={sort}
                      onChange={(event) => setSort(event.target.value)}
                    >
                      <option value="recent">最近游玩</option>
                      <option value="added">最近添加</option>
                      <option value="name">名称排序</option>
                    </select>
                    <ChevronDown size={13} />
                  </div>
                </div>
                {!ready ? (
                  <div className="empty-state">
                    <LoaderCircle className="spin" />
                    <p>正在整理游戏库…</p>
                  </div>
                ) : (
                  <div className={`games-${layout}`}>
                    {visibleGames.map((game) => (
                      <article
                        key={game.id}
                        className={`game-card ${active?.id === game.id ? 'playing' : ''}`}
                      >
                        <button
                          className="game-cover"
                          aria-label={`开始 ${displayTitle(game)}`}
                          onClick={() => void playGame(game)}
                          disabled={busy}
                          style={{ '--cover-color': game.color || '#7286b0' } as CSSProperties}
                        >
                          {isDemo(game) ? (
                            <>
                              <SpaceArt id={`cover-${game.id.slice(0, 8)}`} />
                              <div className="cover-wordmark">
                                <span>AN ORIGINAL ADVENTURE</span>
                                <strong>
                                  STAR
                                  <br />
                                  ORBIT<span>✦</span>
                                </strong>
                              </div>
                            </>
                          ) : (
                            <div className="generic-cover">
                              <div className="cartridge">
                                <Gamepad2 size={34} />
                                <span>
                                  GAME BOY
                                  <br />
                                  <b>ADVANCE</b>
                                </span>
                              </div>
                              <span className="generic-title">{game.title}</span>
                            </div>
                          )}
                          <span className="cover-platform">GBA</span>
                          {isDemo(game) && <span className="demo-badge">原创试玩</span>}
                          <span className="cover-play">
                            <Play size={22} fill="currentColor" />
                          </span>
                          {active?.id === game.id && (
                            <span className="now-playing">
                              <span />
                              正在游玩
                            </span>
                          )}
                        </button>
                        <div className="game-info">
                          <div className="game-name-row">
                            <button
                              className="game-title"
                              onClick={() => void playGame(game)}
                              disabled={busy}
                            >
                              {displayTitle(game)}
                            </button>
                            <div className="game-menu-wrap">
                              <IconButton
                                label={`${game.title} 的更多操作`}
                                onClick={() => setGameMenu(gameMenu === game.id ? null : game.id)}
                              >
                                <MoreHorizontal size={18} />
                              </IconButton>
                              {gameMenu === game.id && (
                                <>
                                  <button
                                    className="menu-dismiss"
                                    aria-label="关闭游戏菜单"
                                    onClick={() => setGameMenu(null)}
                                  />
                                  <div className="game-menu">
                                    <button onClick={() => void favorite(game)}>
                                      <Heart size={14} />
                                      {game.favorite ? '取消收藏' : '添加到收藏'}
                                    </button>
                                    <button
                                      className="danger-text"
                                      disabled={active?.id === game.id || isDemo(game)}
                                      onClick={() => setDeleteTarget(game)}
                                    >
                                      <Trash2 size={14} />
                                      删除游戏及存档
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="game-meta">
                            <span>
                              {isDemo(game) ? '太空探索' : formatSize(game.size)}
                              <i />{' '}
                              {game.lastPlayed ? formatTime(game.playTime) : '等待你的首次冒险'}
                            </span>
                            <button
                              className={`favorite-button ${game.favorite ? 'is-favorite' : ''}`}
                              aria-label={game.favorite ? '取消收藏' : `收藏 ${displayTitle(game)}`}
                              onClick={() => void favorite(game)}
                            >
                              <Heart size={14} fill={game.favorite ? 'currentColor' : 'none'} />
                            </button>
                          </div>
                        </div>
                      </article>
                    ))}
                    {page === 'library' && !search && (
                      <button
                        className="import-card"
                        disabled={busy}
                        onClick={() => inputRef.current?.click()}
                      >
                        <span className="import-circle">
                          <Plus size={25} strokeWidth={1.5} />
                        </span>
                        <strong>下一场冒险，由你选择</strong>
                        <p>点击导入，或将游戏文件拖到这里</p>
                        <span className="file-tag">
                          .gba / .zip<span>自动解压</span>
                        </span>
                      </button>
                    )}
                    {visibleGames.length === 0 && (page !== 'library' || search) && (
                      <div className="empty-state">
                        {search ? (
                          <Search size={30} />
                        ) : page === 'favorites' ? (
                          <Heart size={30} />
                        ) : (
                          <Clock3 size={30} />
                        )}
                        <h3>
                          {search
                            ? '没有找到这个游戏'
                            : page === 'favorites'
                              ? '收藏你的第一款游戏'
                              : '你的冒险即将开始'}
                        </h3>
                        <p>
                          {search
                            ? '换个关键词试试，或导入新的游戏。'
                            : page === 'favorites'
                              ? '点击游戏卡片上的爱心，将喜欢的游戏留在这里。'
                              : '开始一款游戏，下次就能从这里快速找到。'}
                        </p>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setPage('library')
                            setSearch('')
                          }}
                        >
                          返回游戏库
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="library-note">
                  <HardDrive size={14} />
                  <span>
                    {games.length} 个游戏 ·{' '}
                    {formatSize(games.reduce((total, game) => total + game.size, 0))} 本地空间
                  </span>
                  <span>好游戏，值得慢慢玩。</span>
                </div>
                <div className="tip-banner">
                  <div className="tip-icon">
                    <Keyboard size={21} />
                  </div>
                  <div>
                    <strong>熟悉的手感，不止一种方式</strong>
                    <p>键盘、手柄或触屏，用你喜欢的方式玩。</p>
                  </div>
                  <button onClick={() => setModal('controls')}>
                    设置按键
                    <ArrowRight size={15} />
                  </button>
                </div>
              </section>
              <aside className="quick-panel">
                <div className="section-heading">
                  <div className="section-title">
                    <SlidersHorizontal size={17} />
                    <h2>控制中心</h2>
                  </div>
                  <IconButton label="全部模拟器设置" onClick={() => setModal('settings')}>
                    <Settings2 size={16} />
                  </IconButton>
                </div>
                <div className="quick-settings">
                  <div className="setting-caption">
                    <span>
                      <Volume2 size={15} />
                      游戏音量
                    </span>
                    <strong>
                      {Math.round(settings.volume * 100)}
                      <small>%</small>
                    </strong>
                  </div>
                  <input
                    className="volume-slider"
                    aria-label="游戏音量"
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(settings.volume * 100)}
                    style={{ '--range-value': `${settings.volume * 100}%` } as CSSProperties}
                    onChange={(event) => setSetting('volume', Number(event.target.value) / 100)}
                  />
                  <div className="setting-caption speed-caption">
                    <span>
                      <FastForward size={15} />
                      运行速度
                    </span>
                  </div>
                  <div className="segmented">
                    {([1, 2, 4] as const).map((speed) => (
                      <button
                        key={speed}
                        className={settings.speed === speed ? 'active' : ''}
                        onClick={() => setSetting('speed', speed)}
                      >
                        {speed}×{speed === 1 && <span>正常</span>}
                      </button>
                    ))}
                  </div>
                  <div className="quick-divider" />
                  <div className="setting-caption">
                    <span>
                      <ScanLine size={15} />
                      画面滤镜
                    </span>
                    <select
                      aria-label="画面滤镜"
                      value={settings.filter}
                      onChange={(event) =>
                        setSetting('filter', event.target.value as Settings['filter'])
                      }
                    >
                      <option value="pixel">原生像素</option>
                      <option value="smooth">柔和平滑</option>
                      <option value="crt">复古 CRT</option>
                    </select>
                  </div>
                  <div className="setting-caption autosave-row">
                    <span>
                      <Save size={15} />
                      自动存档
                    </span>
                    <Toggle
                      checked={settings.autoSave}
                      onChange={(value) => setSetting('autoSave', value)}
                      label="自动存档"
                    />
                  </div>
                  <p className="setting-help">每 30 秒保存一次，下次接着玩。</p>
                </div>
                <div className="quick-save">
                  <div>
                    <span className="save-icon">
                      <Save size={19} />
                    </span>
                    <div>
                      <strong>把进度，留在此刻</strong>
                      <p>{active ? '随时保存，随时继续' : '启动游戏后即可管理存档'}</p>
                    </div>
                  </div>
                  <button
                    className="button secondary"
                    disabled={!canControl}
                    onClick={() => setModal('states')}
                  >
                    管理即时存档
                    <ChevronRight size={15} />
                  </button>
                </div>
                <div className="core-status">
                  <span className="status-dot" />
                  <span>mGBA 引擎</span>
                  <span>WASM</span>
                </div>
              </aside>
            </div>
          ) : (
            <section className="saved-games">
              <div className="info-banner">
                <ShieldCheck size={19} />
                <span>即时存档保存在此浏览器。导出重要存档，可在清理浏览器数据后恢复进度。</span>
              </div>
              {allStates.length === 0 ? (
                <div className="empty-state">
                  <Save size={36} />
                  <h3>为冒险留一个书签</h3>
                  <p>启动游戏后按 F5 快速存档，或开启自动存档。</p>
                  <button className="button primary" onClick={() => navigate('library')}>
                    去游戏库
                    <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="state-grid">
                  {allStates
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((state) => {
                      const game = games.find((g) => g.id === state.gameId)
                      return (
                        game && (
                          <article key={state.id} className="state-card">
                            {state.screenshot ? (
                              <img src={state.screenshot} alt={`${displayTitle(game)} 存档画面`} />
                            ) : (
                              <div className="state-placeholder">
                                <Save />
                              </div>
                            )}
                            <div>
                              <span className="slot-label">
                                {state.slot === 0 ? '自动存档' : `存档位 ${state.slot}`}
                              </span>
                              <h3>{displayTitle(game)}</h3>
                              <p>{formatDate(state.createdAt)}</p>
                              <div className="state-actions">
                                <button
                                  className="button primary"
                                  disabled={busy}
                                  onClick={() => void playGame(game, state)}
                                >
                                  <Play size={14} />
                                  继续游戏
                                </button>
                                <IconButton
                                  label="导出即时存档"
                                  onClick={() =>
                                    download(state.data, `${game.title}-${state.slot}.state`)
                                  }
                                >
                                  <Download size={16} />
                                </IconButton>
                                <IconButton
                                  label="删除即时存档"
                                  onClick={() =>
                                    void run(async () => {
                                      await db.deleteState(game.id, state.slot)
                                      setAllStates((previous) =>
                                        previous.filter((s) => s.id !== state.id),
                                      )
                                      if (active?.id === game.id)
                                        setStates(await db.getStates(game.id))
                                      notify('即时存档已删除')
                                    })
                                  }
                                >
                                  <Trash2 size={16} />
                                </IconButton>
                              </div>
                            </div>
                          </article>
                        )
                      )
                    })}
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>
              MADE FOR THE LOVE OF PLAY<span className="footer-star">✳</span>
            </span>
            <span>
              <CloudOff size={13} />
              本地游戏，本地存档，无需账号
            </span>
          </footer>
        </main>
      </div>

      {(modal || deleteTarget) && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setModal(null)
              setMapping(null)
              setDeleteTarget(null)
            }
          }}
        >
          <div
            className={`modal ${modal === 'states' ? 'wide-modal' : ''}`}
            ref={modalRef}
            role={deleteTarget ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">MAKE IT YOURS</span>
                <h2 id="modal-title">
                  {deleteTarget
                    ? '删除这个游戏？'
                    : modal === 'controls'
                      ? '找到你的顺手操作'
                      : modal === 'settings'
                        ? '你的模拟器，你来定义'
                        : modal === 'states'
                          ? '给冒险留个书签'
                          : '准备好，开始冒险'}
                </h2>
              </div>
              <IconButton
                label="关闭对话框"
                onClick={() => {
                  setModal(null)
                  setMapping(null)
                  setDeleteTarget(null)
                }}
              >
                <X size={20} />
              </IconButton>
            </div>
            {deleteTarget ? (
              <>
                <p className="modal-description">
                  将删除「{displayTitle(deleteTarget)}
                  」及其所有本地存档。此操作无法撤销，请先导出需要保留的存档。
                </p>
                <div className="modal-actions">
                  <button className="button secondary" onClick={() => setDeleteTarget(null)}>
                    取消
                  </button>
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => void deleteGame()}
                  >
                    <Trash2 size={16} />
                    确认删除
                  </button>
                </div>
              </>
            ) : modal === 'controls' ? (
              <>
                <p className="modal-description">
                  点击按键可重新映射。点击游戏画面后使用键盘，按 Esc
                  离开画面焦点。标准手柄按任意按钮即可识别。
                </p>
                <div className={`controller-status ${gamepad ? 'connected' : ''}`}>
                  <Gamepad2 size={21} />
                  <div>
                    <strong>{gamepad ? '手柄已连接，可以开始游戏' : '键盘已就绪'}</strong>
                    <p>
                      {gamepad
                        ? '左摇杆 / 十字键移动 · A / B 操作 · 肩键 L / R'
                        : '支持 Xbox、PlayStation 等标准映射手柄'}
                    </p>
                    <span className="status-dot" />
                  </div>
                </div>
                <div className="key-bindings">
                  {(Object.keys(defaultBindings) as GbaButton[]).map((key) => (
                    <div className="key-binding" key={key}>
                      <span>{buttonNames[key]}</span>
                      <button
                        className={mapping === key ? 'listening' : ''}
                        onClick={() => setMapping(key)}
                      >
                        {mapping === key ? '按下新按键…' : keyLabel(settings.bindings[key])}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="modal-setting">
                  <div>
                    <strong>显示触屏按键</strong>
                    <p>手机与平板默认显示虚拟手柄</p>
                  </div>
                  <Toggle
                    label="显示触屏按键"
                    checked={settings.touch}
                    onChange={(value) => setSetting('touch', value)}
                  />
                </div>
                <div className="modal-actions">
                  <button
                    className="text-button"
                    onClick={() => {
                      setSetting('bindings', defaultBindings)
                      setMapping(null)
                      notify('已恢复默认按键')
                    }}
                  >
                    <RotateCcw size={14} />
                    恢复默认
                  </button>
                  <button
                    className="button primary"
                    onClick={() => {
                      setModal(null)
                      setMapping(null)
                    }}
                  >
                    <Check size={16} />
                    完成设置
                  </button>
                </div>
              </>
            ) : modal === 'settings' ? (
              <>
                <p className="modal-description">设置会自动保存，并应用到接下来每一次游戏。</p>
                <div className="modal-setting">
                  <div>
                    <strong>画面显示</strong>
                    <p>原生像素最接近 GBA 的真实画面</p>
                  </div>
                  <select
                    value={settings.filter}
                    aria-label="设置画面显示"
                    onChange={(event) =>
                      setSetting('filter', event.target.value as Settings['filter'])
                    }
                  >
                    <option value="pixel">原生像素</option>
                    <option value="smooth">柔和平滑</option>
                    <option value="crt">复古 CRT</option>
                  </select>
                </div>
                <div className="modal-setting">
                  <div>
                    <strong>运行速度</strong>
                    <p>加速对话或练级，也可按住 Tab 临时快进</p>
                  </div>
                  <select
                    aria-label="设置运行速度"
                    value={settings.speed}
                    onChange={(event) =>
                      setSetting('speed', Number(event.target.value) as Settings['speed'])
                    }
                  >
                    <option value="1">1× 正常</option>
                    <option value="2">2× 快进</option>
                    <option value="4">4× 快进</option>
                  </select>
                </div>
                <div className="modal-setting">
                  <div>
                    <strong>游戏音量</strong>
                    <p>{Math.round(settings.volume * 100)}%</p>
                  </div>
                  <input
                    aria-label="设置游戏音量"
                    type="range"
                    min="0"
                    max="100"
                    value={settings.volume * 100}
                    onChange={(event) => setSetting('volume', Number(event.target.value) / 100)}
                  />
                </div>
                <div className="modal-setting">
                  <div>
                    <strong>自动存档与恢复</strong>
                    <p>每 30 秒、返回游戏库和切到后台时保存</p>
                  </div>
                  <Toggle
                    label="自动存档与恢复"
                    checked={settings.autoSave}
                    onChange={(value) => setSetting('autoSave', value)}
                  />
                </div>
                <div className="modal-setting">
                  <div>
                    <strong>触屏手柄</strong>
                    <p>在桌面上也显示触屏按键</p>
                  </div>
                  <Toggle
                    label="触屏手柄"
                    checked={settings.touch}
                    onChange={(value) => setSetting('touch', value)}
                  />
                </div>
                <div className="info-banner">
                  <HardDrive size={19} />
                  <span>
                    已使用 {formatSize(games.reduce((size, g) => size + g.size, 0))}{' '}
                    游戏存储。清理浏览器数据会移除游戏和存档，建议定期导出备份。
                  </span>
                </div>
              </>
            ) : modal === 'states' ? (
              <>
                <p className="modal-description">
                  {active && displayTitle(active)}
                  <span> · 即时存档记录游戏此刻的完整状态</span>
                </p>
                <div className="slot-grid">
                  {[0, 1, 2, 3, 4, 5].map((slot) => {
                    const state = states.find((s) => s.slot === slot)
                    return (
                      <div className={`save-slot ${state ? 'filled' : ''}`} key={slot}>
                        <div className="slot-preview">
                          {state?.screenshot ? (
                            <img src={state.screenshot} alt={`存档位 ${slot} 画面`} />
                          ) : (
                            <Save size={28} />
                          )}
                          <span>{slot === 0 ? '自动存档' : `存档位 ${slot}`}</span>
                        </div>
                        <p>{state ? formatDate(state.createdAt) : '等待一段冒险'}</p>
                        <div>
                          <button
                            disabled={!canControl}
                            onClick={() => void run(() => snapshot(slot))}
                          >
                            <Save size={14} />
                            {state ? '覆盖' : '保存'}
                          </button>
                          <button
                            disabled={!state || !canControl}
                            onClick={() => void loadSlot(slot)}
                          >
                            <Play size={14} />
                            读取
                          </button>
                          {state && (
                            <IconButton
                              label={`导出存档位 ${slot}`}
                              onClick={() => download(state.data, `${active?.title}-${slot}.state`)}
                            >
                              <Download size={14} />
                            </IconButton>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="save-transfers">
                  <button
                    className="button secondary"
                    disabled={!canControl}
                    onClick={() => stateInputRef.current?.click()}
                  >
                    <Upload size={15} />
                    导入即时存档
                  </button>
                  <button
                    className="button secondary"
                    disabled={!canControl}
                    onClick={() => void exportBattery()}
                  >
                    <ArrowDownToLine size={15} />
                    导出 .sav
                  </button>
                  <button
                    className="button secondary"
                    disabled={!canControl}
                    onClick={() => saveInputRef.current?.click()}
                  >
                    <ArrowUpFromLine size={15} />
                    导入 .sav
                  </button>
                </div>
                <p className="small-note">
                  .sav 是游戏内的电池存档；导入后会重启游戏。即时存档请使用当前游戏生成的 mGBA
                  存档。
                </p>
              </>
            ) : (
              <>
                <p className="modal-description">
                  Advance 是一个在浏览器中运行的 GBA 模拟器。导入你的 .gba 或 .zip
                  游戏，或先体验内置的原创游戏 Star Orbit。
                </p>
                <div className="help-steps">
                  <div>
                    <span>01</span>
                    <strong>带上你的游戏</strong>
                    <p>
                      点击「导入游戏」，或拖入 .gba / .zip 文件。ZIP
                      中的游戏会自动解压，包括子文件夹。单个 ROM 最大 32 MB，ZIP 最大 64
                      MB，每包最多 32 个游戏、解压合计 128 MB；不支持密码压缩包。
                    </p>
                  </div>
                  <div>
                    <span>02</span>
                    <strong>用熟悉的方式玩</strong>
                    <p>
                      点击游戏画面后，方向键移动，X / Z 对应 A / B，A / S 对应肩键，Enter 开始，右
                      Shift 选择。按 Esc 离开游戏焦点。
                    </p>
                  </div>
                  <div>
                    <span>03</span>
                    <strong>每次回来，接着冒险</strong>
                    <p>
                      开启自动存档后每 30 秒保存进度，也可使用 5 个手动存档位。重要存档记得导出。
                    </p>
                  </div>
                </div>
                <div className="shortcut-grid">
                  {[
                    ['按住倒带', 'Backspace'],
                    ['暂停 / 继续', 'Space'],
                    ['快速存档（位 1）', 'F5'],
                    ['快速读档（位 1）', 'F8'],
                    ['按住快进', 'Tab'],
                    ['进入 / 退出全屏', 'F11'],
                  ].map(([name, key]) => (
                    <div key={key}>
                      <span>{name}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
                <div className="demo-help">
                  <Sparkles size={18} />
                  <div>
                    <strong>Star Orbit · 原创试玩</strong>
                    <p>
                      方向键驾驶飞船，X 加速，Z 发出脉冲，Enter 重新开始。试着探索这片小小宇宙。
                    </p>
                  </div>
                </div>
                <p className="small-note">
                  基于 mGBA WebAssembly 内核 · 商业游戏需自行提供合法获得的
                  ROM。暂不支持联机、作弊码与密码压缩包。
                </p>
              </>
            )}
          </div>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Upload size={40} />
            <h2>放下游戏，开启冒险。</h2>
            <p>支持 .gba / .zip · ROM 最大 32 MB · ZIP 最大 64 MB · 自动解压游戏</p>
          </div>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
