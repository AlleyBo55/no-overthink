import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache } from '../src/lru.js';

test('evicts the least recently used key', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

test('updating a key marks it as recently used', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10);
  cache.set('c', 3);
  assert.equal(cache.get('a'), 10);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.size, 2);
});
