// Benchmark tasks. Each run starts from a fresh copy of bench/fixtures/<fixture>.
// check() decides pass/fail from the final project state and the agent's last reply.
// pristine(file) runs the fixture's original copy of a test file against the final code,
// so adding tests is fine but editing existing ones to pass is not.
// Question checks only read the reply, so report.mjs can re-score stored replies.

const ok = (result) => result.code === 0;

const SLUGIFY_CHECK = `
const { slugify } = await load('src/strings.js');
const cases = [
  ['  Hello, World!  ', 'hello-world'],
  ['a__b--c', 'a-b-c'],
  ['---x---', 'x'],
  ['Already-Slug', 'already-slug'],
  ['Rock & Roll 2', 'rock-roll-2'],
];
for (const [input, want] of cases) assert.equal(slugify(input), want, JSON.stringify(input));
`;

const RENAME_CHECK = `
const api = await load('src/api.js');
const admin = await load('src/admin.js');
assert.equal(typeof api.fetchUser, 'function');
assert.deepEqual(await api.fetchUser(2), { id: 2, name: 'Linus' });
assert.equal(await admin.describeUser(1), '1: Ada');
`;

const LRU_CHECK = `
const { LRUCache } = await load('src/lru.js');
const one = new LRUCache(1);
one.set('a', 1);
one.set('b', 2);
assert.equal(one.get('a'), undefined);
assert.equal(one.get('b'), 2);
const cache = new LRUCache(3);
cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);
cache.get('a');
cache.set('b', 20);
cache.set('d', 4);
assert.equal(cache.get('c'), undefined);
assert.equal(cache.get('a'), 1);
assert.equal(cache.get('b'), 20);
assert.equal(cache.get('d'), 4);
assert.equal(cache.size, 3);
`;

export const tasks = [
  {
    id: 'qa-git',
    kind: 'question',
    fixture: 'qa',
    prompt: 'How do I undo my last git commit but keep the changes staged?',
    check: async ({ text }) => /git reset --soft\s+(HEAD(~1?|\^)|@~1?)/i.test(text),
  },
  {
    id: 'qa-float',
    kind: 'question',
    fixture: 'qa',
    prompt: 'Why is `0.1 + 0.2 === 0.3` false in JavaScript, and how should I compare the two numbers instead?',
    check: async ({ text }) =>
      /binary|ieee|floating[- ]point/i.test(text) && /epsilon|math\.abs|tolerance|tofixed/i.test(text),
  },
  {
    id: 'explain',
    kind: 'question',
    fixture: 'retry',
    prompt: 'What does `retry` in src/retry.js do?',
    check: async ({ text }) => /exponential|backoff|doubl|2\s*(\^|\*\*)\s*attempt|waits? longer/i.test(text),
  },
  {
    id: 'fix-test',
    kind: 'code',
    fixture: 'cart',
    prompt: '`npm test` is failing. Fix it.',
    check: async ({ pristine }) => ok(await pristine('test/cart.test.js')),
  },
  {
    id: 'crash',
    kind: 'code',
    fixture: 'report',
    prompt: "`node src/report.js` crashes with `TypeError: Cannot read properties of undefined (reading 'length')`. Fix it.",
    check: async ({ sh }) => {
      const result = await sh('node src/report.js');
      return result.code === 0 && result.stdout.trim() === '3 orders, 3 items';
    },
  },
  {
    id: 'add-fn',
    kind: 'code',
    fixture: 'strings',
    prompt:
      'Add an exported `slugify(text)` function to src/strings.js. It lowercases and trims the text, replaces each run of non-alphanumeric characters with a single `-`, and removes leading and trailing `-`.',
    check: async ({ pristine, nodeCheck }) =>
      ok(await pristine('test/strings.test.js')) && ok(await nodeCheck(SLUGIFY_CHECK)),
  },
  {
    id: 'rename',
    kind: 'code',
    fixture: 'users',
    prompt: 'Rename `fetchUsr` to `fetchUser` everywhere.',
    check: async ({ sh, nodeCheck }) =>
      (await sh('grep -rn fetchUsr src test')).stdout.trim() === '' &&
      ok(await sh('node --test')) &&
      ok(await nodeCheck(RENAME_CHECK)),
  },
  {
    id: 'lru',
    kind: 'code',
    fixture: 'lru',
    prompt: 'The LRU cache tests fail. Fix src/lru.js.',
    check: async ({ pristine, nodeCheck }) => ok(await pristine('test/lru.test.js')) && ok(await nodeCheck(LRU_CHECK)),
  },
];
