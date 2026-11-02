import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartTotal, itemCount } from '../src/cart.js';

const items = [
  { sku: 'A', price: 10, qty: 2 },
  { sku: 'B', price: 5.5, qty: 1 },
];

test('totals all items', () => {
  assert.equal(cartTotal(items), 25.5);
});

test('applies a percentage discount', () => {
  assert.equal(cartTotal(items, 10), 22.95);
});

test('empty cart is zero', () => {
  assert.equal(cartTotal([]), 0);
});

test('counts items', () => {
  assert.equal(itemCount(items), 3);
});
