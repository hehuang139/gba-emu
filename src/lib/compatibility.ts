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

class ProbeTimeoutError extends Error {}

function safely<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeTimeoutError()), timeoutMs)
    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

let probeSequence = 0

async function probeIndexedDB(
  environment: ProbeEnvironment,
  timeoutMs: number,
): Promise<CapabilityCheck> {
  const check: CapabilityCheck = {
    id: 'indexedDB',
    label: 'IndexedDB',
    status: 'error',
    detail: '浏览器未提供可访问的本地数据库',
    action: '请检查本站点的存储权限与浏览器隐私设置，然后刷新页面重试。',
  }
  let factory: IDBFactory
  try {
    factory = environment.indexedDB as IDBFactory
    if (!factory || !hasFunction(factory.open) || !hasFunction(factory.deleteDatabase)) return check
  } catch {
    return check
  }

  // Never open the application's database. Only delete a database created by
  // this probe's upgrade event, even in the unlikely event of a name collision.
  const name = `advance-capability-probe-${Date.now()}-${++probeSequence}-${Math.random().toString(36).slice(2)}`
  let database: IDBDatabase | undefined
  let transaction: IDBTransaction | undefined
  let owned = false
  let cancelled = false
  let cleanup: Promise<void> | undefined
  const release = () => {
    safely(() => {
      transaction?.abort()
      return true
    }, false)
    safely(() => {
      database?.close()
      return true
    }, false)
  }
  const removeDatabase = (): Promise<void> => {
    release()
    if (!owned) return Promise.resolve()
    if (cleanup) return cleanup
    cleanup = new Promise<void>((resolve, reject) => {
      try {
        const request = factory.deleteDatabase(name)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('临时数据库清理被阻止'))
      } catch (error) {
        reject(error)
      }
    })
    return cleanup
  }

  let verified = false
  const operation = (async () => {
    try {
      database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = factory.open(name, 1)
        request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('本地数据库打开被阻止'))
        request.onupgradeneeded = (event) => {
          try {
            if (cancelled || event.oldVersion !== 0) {
              request.transaction?.abort()
              return
            }
            owned = true
            request.result.createObjectStore('probe')
          } catch (error) {
            safely(() => {
              request.transaction?.abort()
              return true
            }, false)
            reject(error)
          }
        }
        request.onsuccess = () => {
          try {
            database = request.result
            if (cancelled || !owned) {
              database.close()
              reject(new Error('本地数据库检查已取消'))
              return
            }
            database.onversionchange = () => database?.close()
            resolve(database)
          } catch (error) {
            reject(error)
          }
        }
      })
      if (cancelled) throw new ProbeTimeoutError()
      await new Promise<void>((resolve, reject) => {
        transaction = database!.transaction('probe', 'readwrite')
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction?.error)
        transaction.objectStore('probe').put(name, 'value')
      })
      if (cancelled) throw new ProbeTimeoutError()
      await new Promise<void>((resolve, reject) => {
        transaction = database!.transaction('probe', 'readonly')
        transaction.onabort = () => reject(transaction?.error)
        const request = transaction.objectStore('probe').get('value')
        let matches = false
        request.onsuccess = () => {
          matches = request.result === name
        }
        transaction.oncomplete = () => (matches ? resolve() : reject(new Error('数据库校验失败')))
      })
      verified = true
    } finally {
      await removeDatabase()
    }
  })()

  try {
    await withTimeout(operation, timeoutMs)
    return {
      ...check,
      status: 'ok',
      detail: '本地数据库读写验证通过，临时数据已清理',
      action: undefined,
    }
  } catch (error) {
    cancelled = true
    release()
    // The open request cannot be cancelled. Its late events still close the
    // connection and run the same cleanup path; this catch handles that result.
    void removeDatabase().catch(() => {})
    return {
      ...check,
      status: verified ? 'warning' : 'error',
      detail: verified
        ? '本地数据库读写可用，临时检查数据尚未清理'
        : error instanceof ProbeTimeoutError
          ? '本地数据库读写检查超时'
          : '浏览器拒绝本地数据库读写',
    }
  }
}

async function probeStorageQuota(
  environment: ProbeEnvironment,
  timeoutMs: number,
): Promise<CapabilityCheck> {
  const check: CapabilityCheck = {
    id: 'storageQuota',
    label: '存储空间',
    status: 'warning',
    detail: '未提供存储配额信息',
    action: '无法估算可用空间；仍可尝试导入游戏，请定期导出存档备份。',
  }
  try {
    const storage = environment.navigator?.storage
    if (!storage || !hasFunction(storage.estimate)) return check
    const result = await withTimeout(Promise.resolve(storage.estimate()), timeoutMs)
    const quota = result.quota
    const usage = result.usage
    if (
      typeof quota !== 'number' ||
      !Number.isFinite(quota) ||
      quota <= 0 ||
      typeof usage !== 'number' ||
      !Number.isFinite(usage) ||
      usage < 0
    )
      return check
    const free = Math.max(0, quota - usage)
    return {
      ...check,
      status: free < 32 * 1048576 ? 'warning' : 'ok',
      detail: `可用空间约 ${Math.round(free / 1048576)} MB`,
      action:
        free < 32 * 1048576 ? '可用空间较少，请先导出备份，再清理无用游戏或存档。' : undefined,
    }
  } catch (error) {
    return {
      ...check,
      detail: error instanceof ProbeTimeoutError ? '存储配额检查超时' : '浏览器拒绝读取存储配额',
    }
  }
}

export async function probeCompatibility(
  environment: ProbeEnvironment = globalThis as unknown as ProbeEnvironment,
  options: { timeoutMs?: number } = {},
): Promise<CompatibilityReport> {
  const timeoutMs =
    typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs)
      ? Math.max(1, options.timeoutMs)
      : 2000
  const checks: CapabilityCheck[] = []
  const isolated = safely(() => environment.crossOriginIsolated === true, false)
  checks.push({
    id: 'isolation',
    label: '跨源隔离',
    status: isolated ? 'ok' : 'error',
    detail: isolated ? 'COOP / COEP 已启用' : 'SharedArrayBuffer 线程无法启动',
    action: isolated
      ? undefined
      : '请使用 HTTPS 或 localhost，并配置 COOP: same-origin 与 COEP: require-corp 后刷新页面。',
  })

  const sab = safely(() => hasFunction(environment.SharedArrayBuffer), false)
  checks.push({
    id: 'sharedArrayBuffer',
    label: 'SharedArrayBuffer',
    status: sab ? 'ok' : 'error',
    detail: sab ? '浏览器支持 WebAssembly 线程内存' : '浏览器未提供 SharedArrayBuffer',
    action: sab ? undefined : '请升级浏览器，并确认页面处于跨源隔离环境。',
  })

  const wasm = safely(() => {
    const api = environment.WebAssembly as { instantiate?: unknown; compile?: unknown } | undefined
    return Boolean(api && (hasFunction(api.instantiate) || hasFunction(api.compile)))
  }, false)
  checks.push({
    id: 'wasm',
    label: 'WebAssembly',
    status: wasm ? 'ok' : 'error',
    detail: wasm ? '可以加载 mGBA 模拟核心' : '浏览器不支持 WebAssembly',
    action: wasm ? undefined : '请升级浏览器后重试。',
  })

  let webgl = false
  let context: WebGLRenderingContext | null = null
  try {
    const canvas = environment.document?.createElement?.('canvas')
    context = (canvas?.getContext?.('webgl2') ||
      canvas?.getContext?.('webgl')) as WebGLRenderingContext | null
    webgl = Boolean(context)
  } catch {
    webgl = false
  } finally {
    safely(() => {
      context?.getExtension?.('WEBGL_lose_context')?.loseContext()
      return true
    }, false)
  }
  checks.push({
    id: 'webgl',
    label: 'WebGL',
    status: webgl ? 'ok' : 'error',
    detail: webgl ? '可以显示游戏画面' : '无法创建 WebGL 上下文',
    action: webgl ? undefined : '请启用硬件加速，或更新显卡驱动与浏览器。',
  })

  checks.push(
    ...(await Promise.all([
      probeIndexedDB(environment, timeoutMs),
      probeStorageQuota(environment, timeoutMs),
    ])),
  )

  return { checks, ready: checks.every((check) => check.status !== 'error') }
}
