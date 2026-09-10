import test from 'node:test'
import assert from 'node:assert/strict'
import { coreForPlatform, requireCoreForPlatform } from './core-registry.ts'

test('exposes bundled GBA capabilities', () => {
  const core = requireCoreForPlatform('gba')
  assert.equal(core.id, 'mgba-wasm')
  assert.equal(core.capabilities.rewind, true)
})

test('reports unavailable platforms explicitly', () => {
  assert.equal(coreForPlatform('nes'), null)
  assert.throws(() => requireCoreForPlatform('ps2'), /PlayStation 2.*尚未集成核心/)
})
