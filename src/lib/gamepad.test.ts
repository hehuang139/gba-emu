import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceGamepadCapture,
  aggregateGamepadButtons,
  assignGamepadBinding,
  beginGamepadCapture,
  decodeGamepadProfiles,
  defaultGamepadProfile,
  diffGamepadButtons,
  gamepadProfileKey,
  mappedGamepadButtons,
  validateGamepadProfile,
} from './gamepad.ts'
import type { GamepadSnapshot } from './gamepad.ts'

function pad(overrides: Partial<GamepadSnapshot> = {}): GamepadSnapshot {
  return {
    id: 'Test controller',
    index: 0,
    mapping: 'standard',
    connected: true,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
    ...overrides,
  }
}

function press(device: GamepadSnapshot, index: number, value = 1): GamepadSnapshot {
  return {
    ...device,
    buttons: device.buttons.map((button, current) =>
      current === index ? { pressed: value > 0.5, value } : button,
    ),
  }
}

test('standard defaults preserve face, shoulder, menu, dpad and left-stick inputs', () => {
  let device = pad()
  const profile = defaultGamepadProfile(device)
  for (const index of [0, 1, 4, 5, 8, 9, 12, 13, 14, 15]) device = press(device, index)
  assert.deepEqual(
    [...mappedGamepadButtons(device, profile)].sort(),
    ['A', 'B', 'Down', 'L', 'Left', 'R', 'Right', 'Select', 'Start', 'Up'].sort(),
  )
  assert.deepEqual([...mappedGamepadButtons(pad({ axes: [-0.7, 0.7] }), profile)], ['Down', 'Left'])
})

test('nonstandard devices have no guessed mappings and can assign buttons and signed axes', () => {
  const device = press(pad({ mapping: '', axes: [0.8, -0.8] }), 3)
  let profile = defaultGamepadProfile(device)
  assert.equal(mappedGamepadButtons(device, profile).size, 0)
  profile = assignGamepadBinding(profile, 'A', { type: 'button', index: 3 }).profile
  profile = assignGamepadBinding(profile, 'Up', { type: 'axis', index: 1, direction: -1 }).profile
  assert.deepEqual([...mappedGamepadButtons(device, profile)], ['Up', 'A'])
})

test('per-device identity survives slot changes and distinguishes layouts and identifiers', () => {
  const device = pad()
  assert.equal(gamepadProfileKey(device), gamepadProfileKey(pad({ index: 3 })))
  for (const other of [
    pad({ id: 'Another' }),
    pad({ mapping: '' }),
    pad({ axes: [0] }),
    pad({ buttons: [] }),
  ]) {
    assert.notEqual(gamepadProfileKey(device), gamepadProfileKey(other))
  }
})

test('profile round trip keeps complete custom mappings and independent deadzones', () => {
  const device = pad({ mapping: '' })
  const profile = assignGamepadBinding(defaultGamepadProfile(device), 'Start', {
    type: 'button',
    index: 10,
  }).profile
  profile.deadzone = 0.7
  const key = gamepadProfileKey(device)
  const saved = decodeGamepadProfiles(JSON.stringify({ version: 1, profiles: { [key]: profile } }))
  assert.deepEqual(validateGamepadProfile(saved[key], device), profile)
  assert.equal(defaultGamepadProfile(pad({ id: 'Other' })).deadzone, 0.45)
})

test('malformed containers, oversized storage and future versions fall back safely', () => {
  for (const value of [
    null,
    '{',
    'null',
    '[]',
    '{}',
    '{"version":2,"profiles":{}}',
    '{"version":1,"profiles":[]}',
    ' '.repeat(262_145),
  ]) {
    assert.deepEqual(decodeGamepadProfiles(value), {})
  }
})

test('profile validation rejects invalid deadzone values, missing buttons and stale mappings', () => {
  const device = pad()
  const profile = defaultGamepadProfile(device)
  assert.deepEqual(validateGamepadProfile(profile, device), profile)
  for (const deadzone of [NaN, Infinity, -1, 0, 0.95, '0.45', null]) {
    assert.equal(validateGamepadProfile({ ...profile, deadzone }, device), null)
  }
  assert.equal(validateGamepadProfile({ ...profile, version: 2 }, device), null)
  assert.equal(
    validateGamepadProfile({ ...profile, bindings: { ...profile.bindings, Fake: [] } }, device),
    null,
  )
  assert.equal(validateGamepadProfile({ ...profile, bindings: { A: [] } }, device), null)
  assert.equal(validateGamepadProfile(profile, pad({ buttons: [] })), null)
  for (const binding of [
    { type: 'button', index: -1 },
    { type: 'button', index: 17 },
    { type: 'button', index: 0.5 },
    { type: 'button', index: '0' },
    { type: 'axis', index: 4, direction: 1 },
    { type: 'axis', index: 0, direction: 0 },
    { type: 'hat', index: 0 },
    null,
  ]) {
    assert.equal(
      validateGamepadProfile(
        { ...profile, bindings: { ...profile.bindings, A: [binding] } },
        device,
      ),
      null,
    )
  }
})

test('deadzone rejects noise and nonfinite values but permits both signed directions', () => {
  const profile = defaultGamepadProfile(pad())
  profile.deadzone = 0.6
  assert.equal(mappedGamepadButtons(pad({ axes: [0.6, -0.6, NaN, Infinity] }), profile).size, 0)
  assert.deepEqual(
    [...mappedGamepadButtons(pad({ axes: [0.61, -0.61] }), profile)],
    ['Up', 'Right'],
  )
  assert.equal(mappedGamepadButtons(pad({ axes: [NaN, Infinity] }), profile).size, 0)
})

test('capture ignores an already held button until it is released then pressed again', () => {
  const held = press(pad(), 0)
  let capture = beginGamepadCapture(held, 0.45)
  let result = advanceGamepadCapture(held, capture, 0.45)
  assert.equal(result.binding, null)
  result = advanceGamepadCapture(pad(), result.capture, 0.45)
  assert.equal(result.binding, null)
  capture = result.capture
  assert.deepEqual(advanceGamepadCapture(held, capture, 0.45).binding, { type: 'button', index: 0 })
})

test('capture detects buttons and axis directions without capturing small drift', () => {
  const capture = beginGamepadCapture(pad(), 0.45)
  assert.equal(advanceGamepadCapture(pad({ axes: [0.54, -0.54] }), capture, 0.45).binding, null)
  assert.deepEqual(advanceGamepadCapture(press(pad(), 6), capture, 0.45).binding, {
    type: 'button',
    index: 6,
  })
  assert.deepEqual(advanceGamepadCapture(pad({ axes: [0, -0.8] }), capture, 0.45).binding, {
    type: 'axis',
    index: 1,
    direction: -1,
  })
  assert.equal(advanceGamepadCapture(pad({ axes: [0.8] }), capture, 0.9).binding, null)
})

test('capture does not let an idle nonzero axis block unrelated button capture', () => {
  const device = pad({ mapping: '', axes: [-1, 0] })
  const capture = beginGamepadCapture(device, 0.45)
  assert.equal(advanceGamepadCapture(device, capture, 0.45).binding, null)
  assert.deepEqual(advanceGamepadCapture(press(device, 2), capture, 0.45).binding, {
    type: 'button',
    index: 2,
  })
})

test('cancelling a capture by discarding its state leaves the profile unchanged', () => {
  const device = pad()
  const profile = defaultGamepadProfile(device)
  const before = structuredClone(profile)
  const capture = beginGamepadCapture(device, profile.deadzone)
  advanceGamepadCapture(press(device, 1), capture, profile.deadzone)
  assert.deepEqual(profile, before)
  assert.deepEqual(
    beginGamepadCapture(press(device, 1), profile.deadzone).blocked,
    new Set(['button:1']),
  )
})

test('assigning an occupied source moves ownership and preserves other default inputs', () => {
  const profile = defaultGamepadProfile(pad())
  const { profile: assigned, displaced } = assignGamepadBinding(profile, 'A', {
    type: 'button',
    index: 12,
  })
  assert.deepEqual(displaced, ['Up'])
  assert.deepEqual(assigned.bindings.A, [{ type: 'button', index: 12 }])
  assert.deepEqual(assigned.bindings.Up, [{ type: 'axis', index: 1, direction: -1 }])
  assert.equal(profile.bindings.Up.length, 2)
})

test('multiple pads retain a shared press until every owning pad releases or disconnects', () => {
  const first = press(pad(), 0)
  const second = press(pad({ index: 1, id: 'Second' }), 0)
  const profile = defaultGamepadProfile(first)
  const before = aggregateGamepadButtons([
    { pad: first, profile },
    { pad: second, profile },
  ])
  const partial = aggregateGamepadButtons([
    { pad: { ...first, connected: false }, profile },
    { pad: second, profile },
  ])
  assert.deepEqual(diffGamepadButtons(before, partial), { pressed: [], released: [] })
  const after = aggregateGamepadButtons([{ pad: { ...second, connected: false }, profile }])
  assert.deepEqual(diffGamepadButtons(partial, after), { pressed: [], released: ['A'] })
})

test('disabled polling output releases all held controls with no repeated release edges', () => {
  const profile = defaultGamepadProfile(pad())
  const held = mappedGamepadButtons(press(pad({ axes: [1, 0] }), 0), profile)
  const empty = new Set<never>()
  assert.deepEqual(diffGamepadButtons(held, empty), { pressed: [], released: ['Right', 'A'] })
  assert.deepEqual(diffGamepadButtons(empty, empty), { pressed: [], released: [] })
})

test('restoring standard and nonstandard defaults removes all customization', () => {
  for (const mapping of ['standard', '']) {
    const device = pad({ mapping })
    const defaults = defaultGamepadProfile(device)
    const custom = assignGamepadBinding(defaults, 'A', {
      type: 'axis',
      index: 3,
      direction: -1,
    }).profile
    custom.deadzone = 0.8
    assert.notDeepEqual(custom, defaults)
    assert.deepEqual(defaultGamepadProfile(device), defaults)
  }
})
