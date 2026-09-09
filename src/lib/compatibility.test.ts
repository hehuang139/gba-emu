import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeCompatibility } from './compatibility.ts'

const healthy = {
  crossOriginIsolated: true,
  SharedArrayBuffer: class SharedArrayBuffer {},
  WebAssembly: { instantiate: async () => ({}) },
  indexedDB: {},
  document: { createElement: () => ({ getContext: () => ({}) }) },
  navigator: { storage: { estimate: async () => ({ usage: 10, quota: 100 * 1048576 }) } },
}

test('reports a fully supported environment and storage headroom', async () => {
  const report = await probeCompatibility(healthy)
  assert.equal(report.ready, true)
  assert.deepEqual(
    report.checks.map((check) => check.status),
    ['ok', 'ok', 'ok', 'ok', 'ok', 'ok'],
  )
  assert.match(report.checks.at(-1)?.detail || '', /可用空间约/)
})

test('explains missing deployment prerequisites', async () => {
  const report = await probeCompatibility({
    crossOriginIsolated: false,
    document: { createElement: () => ({ getContext: () => null }) },
  })
  assert.equal(report.ready, false)
  assert.equal(report.checks.find((check) => check.id === 'isolation')?.status, 'error')
  assert.match(report.checks.find((check) => check.id === 'isolation')?.action || '', /COOP/)
  assert.equal(report.checks.find((check) => check.id === 'storageQuota')?.status, 'warning')
})
