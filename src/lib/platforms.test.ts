import test from 'node:test'
import assert from 'node:assert/strict'
import { platformForFilename, supportedPlatformForFilename } from './platforms.ts'

test('maps planned extensions without claiming runtime support', () => {
  assert.equal(platformForFilename('zelda.GBC')?.id, 'gbc')
  assert.equal(platformForFilename('mario.smc')?.id, 'snes')
  assert.equal(platformForFilename('disc.cue')?.id, 'ps1')
  assert.equal(supportedPlatformForFilename('zelda.gbc'), null)
  assert.equal(supportedPlatformForFilename('demo.gba')?.id, 'gba')
})
