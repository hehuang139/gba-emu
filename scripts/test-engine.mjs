// Integration tests against real mGBA, real WebAssembly threads, and our original ROM.
// Start Vite first. Install playwright or set PLAYWRIGHT_MODULE to its index.mjs.
// Optional: ENGINE_TEST_URL, BROWSER_EXECUTABLE_PATH, ENGINE_SCREENSHOT_PATH.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  const url = process.env.ENGINE_TEST_URL || 'http://127.0.0.1:5173'
  await page.goto(`${url}/src/emulator/verify.html`)
  await page.waitForFunction(() => !!window.emulator)
  assert.equal(await page.evaluate(() => crossOriginIsolated), true, 'COOP/COEP must enable threads')
  await page.evaluate(async () => {
    const bytes = new Uint8Array(await (await fetch('/demo/star-orbit.gba')).arrayBuffer())
    await window.emulator.loadRom(bytes, 'star-orbit.gba')
  })
  assert.equal(await page.evaluate(() => window.emulator.status), 'running')
  await page.waitForFunction(() => window.fps > 25, undefined, { timeout: 10000 })
  const normalFps = await page.evaluate(() => window.fps)

  // Read the actual core framebuffer. Identify only the mint-colored ship in
  // the playfield, excluding both HUD lines, to prove CPU input changes pixels.
  const shipPosition = () => page.evaluate(async () => {
    const bitmap = await createImageBitmap(await window.emulator.screenshot())
    const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = surface.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const { data } = context.getImageData(0, 0, surface.width, surface.height)
    let count = 0, totalX = 0, totalY = 0
    for (let y = 30; y < 140; y++) {
      for (let x = 0; x < 240; x++) {
        const offset = (y * 240 + x) * 4
        if (data[offset] < 180 && data[offset + 1] > 190 && data[offset + 2] > 130) {
          totalX += x; totalY += y; count++
        }
      }
    }
    return { x: totalX / count, y: totalY / count, count, width: surface.width, height: surface.height }
  })

  await page.evaluate(async () => { window.emulator.pause(); window.savedState = await window.emulator.saveState() })
  const start = await shipPosition()
  assert.equal(start.width, 240)
  assert.equal(start.height, 160)
  assert.ok(start.count > 5, 'ROM must render its mint-colored ship')
  const stateSize = await page.evaluate(() => window.savedState.length)
  assert.ok(stateSize > 1000, 'a real state must contain CPU and memory data')

  await page.evaluate(() => { window.emulator.resume(); window.emulator.keyDown('Right') })
  await page.waitForTimeout(350)
  await page.evaluate(() => { window.emulator.keyUp('Right'); window.emulator.pause() })
  const moved = await shipPosition()
  assert.ok(moved.x > start.x + 10, `Right input must move the ship: ${start.x} -> ${moved.x}`)

  await page.evaluate(async () => { await window.emulator.loadState(window.savedState); window.emulator.resume() })
  await page.waitForTimeout(70)
  await page.evaluate(() => window.emulator.pause())
  const restored = await shipPosition()
  assert.ok(Math.abs(restored.x - start.x) < 2, 'loading state must restore position')

  await page.evaluate(() => { window.emulator.resume(); window.emulator.keyDown('Right') })
  await page.waitForTimeout(500)
  await page.evaluate(() => { window.emulator.keyUp('Right'); window.emulator.pause() })
  const beforeRewind = await shipPosition()
  await page.evaluate(() => { window.emulator.resume(); window.emulator.setRewind(true) })
  await page.waitForTimeout(300)
  await page.evaluate(() => { window.emulator.setRewind(false); window.emulator.pause() })
  const rewound = await shipPosition()
  assert.ok(rewound.x < beforeRewind.x - 5, `rewind must restore older frames: ${beforeRewind.x} -> ${rewound.x}`)

  await page.evaluate(() => { window.emulator.setSpeed(2); window.emulator.resume(); window.fps = 0 })
  await page.waitForFunction(() => window.fps > 80, undefined, { timeout: 10000 })
  const fastFps = await page.evaluate(() => window.fps)
  await page.evaluate(() => { window.emulator.setSpeed(1); window.emulator.pause() })

  const saveData = await page.evaluate(async () => {
    const battery = await window.emulator.exportSave()
    if (!battery) return null
    const before = window.saveChanges || 0
    await window.emulator.exportSave()
    return { size: battery.length, before, after: window.saveChanges || 0 }
  })
  if (saveData) {
    assert.equal(saveData.before, saveData.after, 'unchanged battery data must not fire onSaveChange')
    assert.ok(saveData.size >= 512)
    const imported = await page.evaluate(async () => {
      const battery = await window.emulator.exportSave()
      // The original demo persists its score in a tiny, documented SRAM record.
      battery.set([83, 79, 1, 7, 248])
      await window.emulator.importSave(battery)
      const exported = await window.emulator.exportSave()
      return Array.from(exported.slice(0, 5))
    })
    assert.deepEqual(imported, [83, 79, 1, 7, 248], 'battery import must reach the emulated cartridge SRAM')
    assert.equal(await page.evaluate(() => window.emulator.status), 'paused', 'import preserves pause state')
  }

  await page.evaluate(() => window.emulator.reset())
  assert.equal(await page.evaluate(() => window.emulator.status), 'paused')
  if (process.env.ENGINE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.ENGINE_SCREENSHOT_PATH })
  await page.evaluate(() => window.emulator.dispose())
  assert.equal(await page.evaluate(() => window.emulator.status), 'disposed')
  await page.waitForTimeout(200)
  assert.equal(page.workers().length, 0, 'disposal must terminate every emulation worker')
  // Deterministic regression for a queued ScriptProcessor callback from the
  // previous cartridge. Without the audio-instance guard this invokes a freed
  // native pointer, producing divide-by-zero or out-of-bounds WebAssembly errors.
  const audioGuard = await page.evaluate(async () => {
    const { default: createCore } = await import('/emulator/mgba.js')
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    const core = await createCore({ canvas, print: () => {} })
    const wait = () => new Promise(resolve => setTimeout(resolve, 150))
    try {
      for (const directory of ['/data', '/data/games', '/data/saves', '/data/states', '/data/cheats', '/data/screenshots', '/data/patches', '/autosave']) core.FS.mkdir(directory)
      core.setCoreSettings({ autoSaveStateEnable: false, restoreAutoSaveStateOnLoad: false })
      core.FS.writeFile('/data/games/test.gba', new Uint8Array(await (await fetch('/demo/star-orbit.gba')).arrayBuffer()))
      core.loadGame('/data/games/test.gba')
      await wait()
      const oldAudio = core.SDL2.audio
      const staleCallback = oldAudio.scriptProcessorNode.onaudioprocess
      core.quitGame()
      core.loadGame('/data/games/test.gba')
      await wait()
      if (core.SDL2.audio === oldAudio) throw new Error('test requires a new audio instance')
      staleCallback({ outputBuffer: core.SDL2.audioContext.createBuffer(2, 1024, core.SDL2.audioContext.sampleRate) })
      return { staleCallbackIgnored: true, oldHandlerRemoved: oldAudio.scriptProcessorNode.onaudioprocess === null }
    } finally {
      core.hostDispose()
      canvas.remove()
    }
  })
  assert.deepEqual(audioGuard, { staleCallbackIgnored: true, oldHandlerRemoved: true })
  for (let attempt = 0; attempt < 20 && page.workers().length; attempt++) await page.waitForTimeout(50)
  assert.equal(page.workers().length, 0, 'audio regression core must also release all workers')
  assert.deepEqual(errors, [], 'no browser runtime errors')
  console.log(JSON.stringify({ passed: true, normalFps, fastFps, stateSize, start, moved, restored, beforeRewind, rewound, saveData, audioGuard, workersAfterDispose: page.workers().length }, null, 2))
} catch (error) {
  const artifacts = new URL('../.artifacts/', import.meta.url)
  await mkdir(artifacts, { recursive: true })
  await page.screenshot({ path: fileURLToPath(new URL('engine-failure.png', artifacts)), fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
}
