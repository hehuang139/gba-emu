import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createInputController } from './input.ts'

test('overlapping keyboard, touch and gamepad holds release only after the last source', () => {
  const events: string[] = []
  const input = createInputController(
    (b) => events.push(`+${b}`),
    (b) => events.push(`-${b}`),
  )
  input.press('keyboard', 'A')
  input.press('keyboard', 'A')
  input.press('gamepad', 'A')
  input.press('touch', 'A')
  input.release('keyboard', 'A')
  input.release('unknown', 'A')
  input.clear('gamepad')
  assert.deepEqual(events, ['+A'])
  input.release('touch', 'A')
  assert.deepEqual(events, ['+A', '-A'])
})

test('blur/reset releases every hold and accepts fresh input', () => {
  const events: string[] = []
  const input = createInputController(
    (b) => events.push(`+${b}`),
    (b) => events.push(`-${b}`),
  )
  input.press('keyboard', 'Left')
  input.press('gamepad', 'A')
  input.clear()
  input.clear()
  input.release('keyboard', 'Left')
  input.press('keyboard', 'Left')
  assert.deepEqual(events, ['+Left', '+A', '-Left', '-A', '+Left'])
})
