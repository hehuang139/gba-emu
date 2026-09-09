import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultBindings, normalizeSettings } from './preferences.ts'

test('legacy preferences retain keyboard bindings and receive touch defaults', () => {
  const settings = normalizeSettings({ volume: 0.3, touch: true, bindings: { A: 'KeyV' } })
  assert.equal(settings.bindings.A, 'KeyV')
  assert.equal(settings.volume, 0.3)
  assert.equal(settings.touch, true)
  assert.deepEqual(settings.touchConfig, { layout: 'standard', scale: 1, opacity: 1 })
})

test('invalid, reserved and duplicate mappings cannot break startup or trap navigation', () => {
  for (const raw of [
    null,
    [],
    12,
    { volume: Infinity, bindings: { A: 'Tab', B: 'Unidentified' } },
    { bindings: { A: 'KeyZ' } },
    { bindings: { A: 'ControlLeft' } },
  ]) {
    const settings = normalizeSettings(raw)
    assert.deepEqual(settings.bindings, defaultBindings)
    assert.equal(settings.volume, 0.65)
  }
  assert.notEqual(normalizeSettings(null).bindings, defaultBindings)
})
