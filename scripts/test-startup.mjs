import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:5173'
const errors = []
async function storedSaves(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('advance-gba')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await Promise.all(
        ['batteries', 'states'].map(
          (name) =>
            new Promise((resolve, reject) => {
              const request = database.transaction(name).objectStore(name).getAll()
              request.onsuccess = () =>
                resolve(request.result.map((row) => ({ ...row, data: Array.from(row.data) })))
              request.onerror = () => reject(request.error)
            }),
        ),
      )
    } finally {
      database.close()
    }
  })
}
async function preparedPage(context) {
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => {
    const start = document.querySelector('.hero-actions button')
    return start && !start.disabled
  })
  // Known progress makes these assertions detect data loss, not only error messages.
  await page.evaluate(async () => {
    localStorage.setItem('advance.settings', JSON.stringify({ autoSave: false }))
    const database = await new Promise((resolve) => {
      const request = indexedDB.open('advance-gba')
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise((resolve, reject) => {
      const tx = database.transaction(['games', 'batteries', 'states'], 'readwrite')
      const request = tx.objectStore('games').getAll()
      request.onsuccess = () => {
        const id = request.result[0].id
        tx.objectStore('batteries').put({ gameId: id, data: new Uint8Array([83, 79, 1, 0, 255]) })
        tx.objectStore('states').put({
          id: `${id}:1`,
          gameId: id,
          slot: 1,
          data: new Uint8Array([1, 2, 3]),
          createdAt: 1,
        })
      }
      tx.oncomplete = resolve
      tx.onabort = () => reject(tx.error)
    })
    database.close()
  })
  return page
}
try {
  for (const failure of ['insecure', 'headers', 'webgl']) {
    const context = await browser.newContext()
    try {
      const page = await preparedPage(context)
      const before = await storedSaves(page)
      if (failure === 'headers') {
        await page.route(url + '/', async (route) => {
          const response = await route.fetch()
          const headers = response.headers()
          delete headers['cross-origin-opener-policy']
          delete headers['cross-origin-embedder-policy']
          await route.fulfill({ response, headers })
        })
      } else {
        await context.addInitScript((mode) => {
          if (mode === 'insecure')
            Object.defineProperty(window, 'isSecureContext', { value: false })
          else {
            const getContext = HTMLCanvasElement.prototype.getContext
            HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
              return kind === 'webgl2' ? null : getContext.call(this, kind, ...args)
            }
          }
        }, failure)
      }
      await page.reload()
      await page.getByRole('button', { name: '开始试玩', exact: true }).click()
      const error = page.locator('.player-overlay[role="alert"]')
      await error.waitFor()
      assert.match(
        await error.innerText(),
        failure === 'insecure' ? /HTTPS|localhost/ : failure === 'headers' ? /COOP|COEP/ : /WebGL/,
      )
      assert.deepEqual(
        await storedSaves(page),
        before,
        `${failure} must preserve existing progress`,
      )
    } finally {
      await context.close()
    }
  }
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(url)
    await page.getByRole('button', { name: '开始试玩', exact: true }).click()
    await page.waitForFunction(() => {
      const pause = document.querySelector('[aria-label="暂停 (Space)"]')
      return pause && !pause.disabled
    })
    await page.keyboard.press('F5')
    await page.getByText('已保存到存档位 1', { exact: true }).waitFor()
    await page.getByRole('button', { name: '暂停 (Space)', exact: true }).click()
    const before = await storedSaves(page)
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (...args) {
        if (['states', 'batteries'].includes(this.name))
          throw new DOMException('Disk full', 'QuotaExceededError')
        return put.apply(this, args)
      }
    })
    await page.locator('canvas').focus()
    await page.keyboard.press('F5')
    await page.getByRole('alert').filter({ hasText: '本地存储空间不足' }).waitFor()
    assert.deepEqual(
      await storedSaves(page),
      before,
      'failed overwrite must preserve existing saves',
    )
    assert.equal(await page.locator('.game-card').count(), 1, 'quota failure keeps library usable')
  } finally {
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'insecure context (injected)',
          'missing isolation headers',
          'WebGL2 unavailable (injected)',
          'quota failure preserves progress',
        ],
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
