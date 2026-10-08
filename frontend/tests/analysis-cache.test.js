import test from 'node:test'
import assert from 'node:assert/strict'
import { createAnalysisRequestCache } from '../src/features/meibography/analysisCache.js'

test('identical analysis requests share the real result and an in-flight request', async () => {
  const cache = createAnalysisRequestCache()
  let calls = 0, resolve
  const result = { gland_count: 8, coverage_pct: 15.3 }
  const run = () => { calls++; return new Promise(done => { resolve = done }) }
  const key = ['patient-1', 'original-image', 'left', 'lower', 50, 50, false, '[]']
  const first = cache.load(key, run)
  const second = cache.load([...key], run)
  assert.equal(first, second)
  await Promise.resolve()
  resolve(result)
  assert.equal(await first, result)
  assert.equal(await cache.load(key, run), result)
  assert.equal(calls, 1)
})

test('every image, eye, lid, adjustment, outline, and patient change requires analysis', async () => {
  const original = ['patient-1', 'image-1', 'left', 'lower', 50, 50, false, '[]']
  for (let index = 0; index < original.length; index++) {
    const cache = createAnalysisRequestCache()
    let calls = 0
    const run = async () => ({ request: ++calls })
    await cache.load(original, run)
    const changed = [...original]
    changed[index] = `${original[index]}-changed`
    await cache.load(changed, run)
    assert.equal(calls, 2)
    // Only the latest image/result is retained.
    await cache.load(original, run)
    assert.equal(calls, 3)
  }
})

test('expiry and patient reset discard previously computed results', async () => {
  let time = 0, calls = 0
  const cache = createAnalysisRequestCache({ ttlMs: 100, now: () => time })
  const run = async () => ({ request: ++calls })
  await cache.load(['image'], run)
  time = 101
  await cache.load(['image'], run)
  cache.clear()
  await cache.load(['image'], run)
  assert.equal(calls, 3)
})

test('failed requests can retry without clearing a newer image result', async () => {
  const cache = createAnalysisRequestCache()
  let reject
  const failed = cache.load(['old-image'], () => new Promise((resolve, fail) => { reject = fail }))
  await Promise.resolve()
  const result = { gland_count: 3 }
  await cache.load(['new-image'], async () => result)
  reject(new Error('Cancelled'))
  await assert.rejects(failed, /Cancelled/)
  assert.equal(await cache.load(['new-image'], () => { throw new Error('Unnecessary request') }), result)
  let calls = 0
  await assert.rejects(cache.load(['retry'], async () => { calls++; throw new Error('Offline') }), /Offline/)
  await cache.load(['retry'], async () => { calls++; return result })
  assert.equal(calls, 2)
})
