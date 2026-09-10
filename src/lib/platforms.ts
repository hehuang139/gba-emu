export type PlatformId = 'gba' | 'gb' | 'gbc' | 'nes' | 'snes' | 'ps1' | 'psp' | 'ps2'

export interface PlatformDefinition {
  id: PlatformId
  name: string
  extensions: readonly string[]
  status: 'supported' | 'planned'
}

export const platforms: readonly PlatformDefinition[] = [
  { id: 'gba', name: 'Game Boy Advance', extensions: ['gba'], status: 'supported' },
  { id: 'gb', name: 'Game Boy', extensions: ['gb'], status: 'planned' },
  { id: 'gbc', name: 'Game Boy Color', extensions: ['gbc'], status: 'planned' },
  { id: 'nes', name: 'Nintendo Entertainment System', extensions: ['nes'], status: 'planned' },
  { id: 'snes', name: 'Super Nintendo Entertainment System', extensions: ['sfc', 'smc'], status: 'planned' },
  { id: 'ps1', name: 'PlayStation', extensions: ['bin', 'cue', 'iso'], status: 'planned' },
  { id: 'psp', name: 'PlayStation Portable', extensions: ['iso', 'cso'], status: 'planned' },
  { id: 'ps2', name: 'PlayStation 2', extensions: ['iso'], status: 'planned' },
]

export function platformForFilename(filename: string): PlatformDefinition | null {
  const extension = filename.toLowerCase().split('.').pop() ?? ''
  return platforms.find((platform) => platform.extensions.includes(extension)) ?? null
}

export function supportedPlatformForFilename(filename: string): PlatformDefinition | null {
  const platform = platformForFilename(filename)
  return platform?.status === 'supported' ? platform : null
}
