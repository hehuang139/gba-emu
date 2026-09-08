/**
 * Capture the README showcase from real app interactions in a fresh browser.
 * Start `npm run dev`, then run `node scripts/capture-showcase.mjs`.
 * Overrides: SHOWCASE_URL, UI_TEST_URL, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE_PATH.
 * Uses only the bundled, original Star Orbit ROM. No user profile is opened.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const executablePath = process.env.BROWSER_EXECUTABLE_PATH ||
  (process.platform === 'win32' && existsSync(edge) ? edge : undefined)
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const baseURL = process.env.SHOWCASE_URL || process.env.UI_TEST_URL || 'http://127.0.0.1:5173'
const output = new URL('../docs/images/', import.meta.url)
const errors = []
const screenshots = []

async function newPage(viewport, mobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(baseURL)
  await page.getByRole('button', { name: '开始试玩', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('.hero-actions button')?.disabled)
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.locator('.game-card').count(), 1, 'only the original bundled game appears')
  return page
}

async function dismissToast(page) {
  const close = page.getByRole('button', { name: '关闭提示', exact: true })
  if (await close.isVisible()) await close.click()
}

async function running(page) {
  await page.waitForFunction(() => {
    const pause = document.querySelector('[aria-label="暂停 (Space)"]')
    return pause && !pause.disabled
  })
  await page.waitForFunction(() => !document.querySelector('.player-overlay'))
  await page.waitForFunction(() => Number(document.querySelector('.fps')?.textContent.replace(/[^\d]/g, '')) > 0)
}

async function capture(page, filename, selector) {
  await dismissToast(page)
  await page.mouse.move(1, 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${filename}: no horizontal overflow`)
  const box = selector ? await page.locator(selector).boundingBox() : null
  const clip = box ? { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: box.height + 48 } : undefined
  await page.screenshot({ path: fileURLToPath(new URL(filename, output)), fullPage: false, animations: 'disabled', ...(clip ? { clip } : {}) })
  screenshots.push(filename)
}

async function moveShip(page, key, duration) {
  await page.locator('canvas').focus()
  await page.keyboard.down(key)
  await page.waitForTimeout(duration)
  await page.keyboard.up(key)
}

try {
  await mkdir(output, { recursive: true })
  const desktop = await newPage({ width: 1440, height: 1000 })
  await capture(desktop, 'desktop-library.png')

  await desktop.getByRole('button', { name: '开始试玩', exact: true }).click()
  await running(desktop)
  await moveShip(desktop, 'ArrowRight', 200)
  await desktop.getByRole('button', { name: '快速存档 (F5)', exact: true }).click()
  await desktop.getByText('已保存到存档位 1', { exact: true }).waitFor()
  await moveShip(desktop, 'ArrowUp', 240)
  await desktop.getByRole('button', { name: '管理即时存档', exact: true }).click()
  await desktop.locator('.save-slot').nth(2).getByRole('button', { name: '保存', exact: true }).click()
  await desktop.getByText('已保存到存档位 2', { exact: true }).waitFor()
  await desktop.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await desktop.getByRole('button', { name: '返回游戏库', exact: true }).click()
  await desktop.getByRole('button', { name: '开始试玩', exact: true }).click()
  await running(desktop)
  await desktop.evaluate(() => window.scrollTo(0, 0))
  await capture(desktop, 'desktop-player.png')

  await desktop.getByRole('button', { name: '管理即时存档', exact: true }).click()
  await desktop.locator('.save-slot.filled img').nth(2).waitFor()
  assert.equal(await desktop.locator('.save-slot.filled').count(), 3, 'one automatic and two manual states were actually saved')
  await capture(desktop, 'save-states.png', '.wide-modal')

  const mobile = await newPage({ width: 390, height: 844 }, true)
  await mobile.getByRole('button', { name: '开始试玩', exact: true }).click()
  await running(mobile)
  await moveShip(mobile, 'ArrowRight', 180)
  assert.equal(await mobile.locator('.touch-controls').isVisible(), true)
  await mobile.evaluate(() => window.scrollTo(0, 0))
  await capture(mobile, 'mobile-player.png')
  assert.deepEqual(errors, [], 'showcase flows have no uncaught browser errors')
  console.log(JSON.stringify({ passed: true, url: baseURL, screenshots, output: fileURLToPath(output) }, null, 2))
} finally {
  await browser.close()
}
