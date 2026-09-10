import type { PlatformDefinition, PlatformId } from '../lib/platforms.ts'
import { platforms } from '../lib/platforms.ts'

export interface CoreCapabilities {
  saveState: boolean
  batterySave: boolean
  rewind: boolean
  screenshot: boolean
  fastForward: boolean
}

export interface CoreDescriptor {
  id: string
  platform: PlatformId
  version: string
  capabilities: CoreCapabilities
  create: () => never
}

const gba: CoreDescriptor = {
  id: 'mgba-wasm',
  platform: 'gba',
  version: '2.5.1',
  capabilities: { saveState: true, batterySave: true, rewind: true, screenshot: true, fastForward: true },
  create: () => { throw new Error('Use createEmulator() for the bundled mGBA adapter.') },
}

const descriptors: readonly CoreDescriptor[] = [gba]

export function platformById(id: PlatformId): PlatformDefinition {
  return platforms.find((platform) => platform.id === id)!
}

export function coreForPlatform(id: PlatformId): CoreDescriptor | null {
  return descriptors.find((descriptor) => descriptor.platform === id) ?? null
}

export function requireCoreForPlatform(id: PlatformId): CoreDescriptor {
  const core = coreForPlatform(id)
  if (core) return core
  const platform = platformById(id)
  throw new Error(`${platform.name} 核心尚未集成，请先使用 GBA 游戏或等待对应平台支持。`)
}

export function listCoreDescriptors(): readonly CoreDescriptor[] { return descriptors }
