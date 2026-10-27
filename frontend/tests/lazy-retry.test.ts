import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadPageWithRetry } from '../src/lib/lazy-retry'

test('retries one transient lazy-page import failure', async () => {
  let attempts = 0
  const result = await loadPageWithRetry(async () => {
    attempts++
    if (attempts === 1) throw new Error('504 stale optimized dependency')
    return 'loaded'
  }, 100, 0)
  assert.equal(result, 'loaded')
  assert.equal(attempts, 2)
})

test('an indefinitely loading chunk rejects after timeout instead of blocking the page', async () => {
  let attempts = 0
  await assert.rejects(loadPageWithRetry(async () => {
    attempts++
    return new Promise<never>(() => undefined)
  }, 15, 0), /demorou demais/)
  assert.equal(attempts, 2)
})
