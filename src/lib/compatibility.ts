export type CapabilityStatus = 'ok' | 'warning' | 'error'

export interface CapabilityCheck {
  id: 'isolation' | 'sharedArrayBuffer' | 'wasm' | 'webgl' | 'indexedDB' | 'storageQuota'
  label: string
  status: CapabilityStatus
  detail: string
  action?: string
}

export interface CompatibilityReport {
  checks: CapabilityCheck[]
  ready: boolean
}

type ProbeEnvironment = {
  crossOriginIsolated?: boolean
  SharedArrayBuffer?: unknown
  WebAssembly?: unknown
  indexedDB?: unknown
  navigator?: {
    storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> }
  }
  document?: {
    createElement?: (tag: string) => {
      getContext?: (kind: string) => unknown
    }
  }
}

const hasFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function'

export async function probeCompatibility(
  environment: ProbeEnvironment = globalThis as unknown as ProbeEnvironment,
): Promise<CompatibilityReport> {
  const checks: CapabilityCheck[] = []
  const isolated = environment.crossOriginIsolated === true
  checks.push({
    id: 'isolation',
    label: '跨源隔离',
    status: isolated ? 'ok' : 'error',
    detail: isolated ? 'COOP / COEP 已启用' : 'SharedArrayBuffer 线程无法启动',
    action: isolated
      ? undefined
      : '请通过项目开发服务访问，或配置 COOP: same-origin 与 COEP: require-corp。',
  })

  const sab = hasFunction(environment.SharedArrayBuffer)
  checks.push({
    id: 'sharedArrayBuffer',
    label: 'SharedArrayBuffer',
    status: sab ? 'ok' : 'error',
    detail: sab ? '浏览器支持 WebAssembly 线程内存' : '浏览器未提供 SharedArrayBuffer',
    action: sab ? undefined : '请升级浏览器，并确认页面处于跨源隔离环境。',
  })

  const wasm = Boolean(
    environment.WebAssembly &&
    (hasFunction((environment.WebAssembly as { instantiate?: unknown }).instantiate) ||
      hasFunction((environment.WebAssembly as { compile?: unknown }).compile)),
  )
  checks.push({
    id: 'wasm',
    label: 'WebAssembly',
    status: wasm ? 'ok' : 'error',
    detail: wasm ? '可以加载 mGBA 模拟核心' : '浏览器不支持 WebAssembly',
    action: wasm ? undefined : '请升级浏览器后重试。',
  })

  let webgl = false
  try {
    const canvas = environment.document?.createElement?.('canvas')
    webgl = Boolean(canvas?.getContext?.('webgl2') || canvas?.getContext?.('webgl'))
  } catch {
    webgl = false
  }
  checks.push({
    id: 'webgl',
    label: 'WebGL',
    status: webgl ? 'ok' : 'error',
    detail: webgl ? '可以显示游戏画面' : '无法创建 WebGL 上下文',
    action: webgl ? undefined : '请启用硬件加速，或更新显卡驱动与浏览器。',
  })

  const indexedDB = typeof environment.indexedDB !== 'undefined'
  checks.push({
    id: 'indexedDB',
    label: 'IndexedDB',
    status: indexedDB ? 'ok' : 'error',
    detail: indexedDB ? '游戏与存档可以保存在本机' : '浏览器未提供本地数据库',
    action: indexedDB ? undefined : '请退出隐私浏览模式，并允许本站点使用本地存储。',
  })

  let quotaDetail = '未提供存储配额信息'
  let quotaStatus: CapabilityStatus = 'warning'
  const storage = environment.navigator?.storage
  if (storage && hasFunction(storage.estimate)) {
    try {
      const result = await storage.estimate()
      const quota = typeof result.quota === 'number' ? result.quota : 0
      const usage = typeof result.usage === 'number' ? result.usage : 0
      if (quota > 0) {
        const free = Math.max(0, quota - usage)
        quotaDetail = `可用空间约 ${Math.round(free / 1048576)} MB`
        quotaStatus = free < 32 * 1048576 ? 'warning' : 'ok'
      }
    } catch {
      quotaDetail = '浏览器拒绝读取存储配额'
    }
  }
  checks.push({
    id: 'storageQuota',
    label: '存储空间',
    status: quotaStatus,
    detail: quotaDetail,
    action:
      quotaStatus === 'warning' ? '空间不足时请清理无用游戏或存档，再导入新内容。' : undefined,
  })

  return { checks, ready: checks.every((check) => check.status !== 'error') }
}
