import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completeProxy, flushFile } from '../../public/emulator/host-sync.js'

test('MEMFS flush and errno results complete the proxy on the current call stack', () => {
  for (const result of [undefined, 0, 29]) {
    const order: string[] = []
    let completed: number | undefined
    const stream = {
      node: { mount: { type: {} } },
      stream_ops: {
        fsync: (received: unknown) => {
          assert.equal(received, stream)
          order.push('fsync')
          return result
        },
      },
    }
    order.push('before')
    completeProxy(flushFile(stream), (value: number) => {
      completed = value
      order.push('completed')
    })
    order.push('after')
    assert.equal(completed, result ?? 0)
    assert.deepEqual(order, ['before', 'fsync', 'completed', 'after'])
  }
  let completed = false
  completeProxy(29, (errno: number) => {
    assert.equal(errno, 29)
    completed = true
  })
  assert.equal(
    completed,
    true,
    'an errno returned by the syscall catch must also complete synchronously',
  )
})

test('mounts without a flush implementation succeed without creating a Promise', () => {
  assert.equal(flushFile({ node: { mount: { type: {} } } }), 0)
  assert.equal(flushFile({ node: { mount: null }, stream_ops: {} }), 0)
})

test('persistent mount success and failure wait for syncfs completion', async () => {
  for (const error of [null, new Error('Storage unavailable')]) {
    let finish: ((error: Error | null) => void) | undefined
    let flushes = 0
    let completed: number | undefined
    const mount = {
      type: {
        syncfs: (received: unknown, populate: boolean, callback: (error: Error | null) => void) => {
          assert.equal(received, mount)
          assert.equal(populate, false)
          finish = callback
        },
      },
    }
    const pending = flushFile({
      node: { mount },
      stream_ops: {
        fsync: () => {
          flushes++
          return 0
        },
      },
    })
    assert.equal(flushes, 1)
    assert.ok(pending instanceof Promise)
    completeProxy(pending, (value: number) => {
      completed = value
    })
    assert.equal(
      completed,
      undefined,
      'persistent writes must not report success before their callback',
    )
    finish!(error)
    assert.equal(
      completed,
      undefined,
      'the persistent mount retains its Promise completion boundary',
    )
    await pending
    assert.equal(completed, error ? 29 : 0)
  }
})

test('thenables retain their own completion behavior without an extra Promise boundary', () => {
  const order: string[] = []
  completeProxy(
    {
      then: (done: (value: number) => void) => {
        order.push('then')
        done(7)
      },
    },
    (value: number) => {
      assert.equal(value, 7)
      order.push('completed')
    },
  )
  order.push('returned')
  assert.deepEqual(order, ['then', 'completed', 'returned'])
})

test('a stream fsync exception reaches the syscall error handler', () => {
  const failure = new Error('Native stream flush failed')
  assert.throws(
    () =>
      flushFile({
        node: { mount: { type: {} } },
        stream_ops: {
          fsync: () => {
            throw failure
          },
        },
      }),
    (error: unknown) => error === failure,
  )
})
