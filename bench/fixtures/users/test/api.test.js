import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchUsr } from '../src/api.js';
import { greet } from '../src/app.js';

test('fetches a user', async () => {
  assert.deepEqual(await fetchUsr(1), { id: 1, name: 'Ada' });
});

test('greets a user', async () => {
  assert.equal(await greet(2), 'Hello, Linus!');
});
