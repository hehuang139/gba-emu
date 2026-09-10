// SPDX-License-Identifier: MPL-2.0

/** MEMFS flushes must finish on this stack; persistent mounts remain asynchronous. */
export function flushFile(stream) {
  const result = stream.stream_ops?.fsync?.(stream)
  const mount = stream.node.mount
  if (!mount?.type?.syncfs) return result ?? 0
  return new Promise((resolve) => {
    mount.type.syncfs(mount, false, (error) => resolve(error ? 29 : 0))
  })
}

/** A synchronous native wait cannot drain JavaScript Promise microtasks. */
export function completeProxy(result, done) {
  if (result && typeof result.then === 'function') return result.then(done)
  return done(result)
}
