import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoundedCache } from '../../src/artifact/cache.ts'

test('the least recently used entry goes first when the count is over', () => {
  const cache = new BoundedCache<string>(2, 100)
  cache.set('a', 'A', 1)
  cache.set('b', 'B', 1)
  assert.equal(cache.get('a'), 'A') // a is now the most recent
  cache.set('c', 'C', 1)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), 'A')
  assert.equal(cache.get('c'), 'C')
  assert.equal(cache.size, 2)
})

test('entries go until the bytes are within the bound', () => {
  const cache = new BoundedCache<string>(10, 10)
  cache.set('a', 'A', 4)
  cache.set('b', 'B', 4)
  cache.set('c', 'C', 4)
  assert.equal(cache.get('a'), undefined)
  assert.equal(cache.bytes, 8)
})

test('a value over the byte bound alone is not kept and evicts nothing', () => {
  const cache = new BoundedCache<string>(10, 10)
  cache.set('a', 'A', 4)
  assert.equal(cache.set('big', 'X', 11), false)
  assert.equal(cache.get('big'), undefined)
  assert.equal(cache.get('a'), 'A')
  assert.equal(cache.set('bad', 'X', Number.NaN), false)
  assert.equal(cache.set('negative', 'X', -1), false)
})

test('setting a key again replaces it and its bytes', () => {
  const cache = new BoundedCache<string>(10, 10)
  cache.set('a', 'A', 4)
  cache.set('a', 'A2', 6)
  assert.equal(cache.get('a'), 'A2')
  assert.equal(cache.bytes, 6)
  assert.equal(cache.size, 1)
  cache.delete('a')
  assert.equal(cache.bytes, 0)
  cache.set('b', 'B', 1)
  cache.clear()
  assert.equal(cache.size, 0)
  assert.equal(cache.bytes, 0)
})

test('a cache with no room keeps nothing', () => {
  const cache = new BoundedCache<string>(0, 10)
  assert.equal(cache.set('a', 'A', 1), false)
  assert.equal(cache.size, 0)
})
