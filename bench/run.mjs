#!/usr/bin/env node
// Measures the model-specific Claude rules. Each task runs in a small coding-agent loop
// (list/read/write/edit files, bash) against the Anthropic Messages API, once per arm:
//   without  no rules, model's default effort
//   with     the matching model rule injected the way coding tools inject persistent instructions
//   quick    rules + the /quick skill text + effort "low" (what /quick does in Claude Code)
// One JSON line per run is appended to the output file. Summarize with report.mjs.
//
// Usage: ANTHROPIC_API_KEY=... node bench/run.mjs [--models a,b] [--arms without,with,quick]
//        [--tasks id,id] [--reps 3] [--concurrency 4] [--effort max] [--out bench/results/file.jsonl]
// --effort sets the effort for the without/with arms (default: the model's own default).
//
// The agent runs model-written code on this machine, inside a temp copy of each fixture,
// with HOME pointed at that copy and no API keys in its environment.

import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { tasks } from './tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULE_FILE_BY_MODEL = {
  'claude-opus-5-5': 'anthropic-claude-opus-5.5.md',
  'claude-fable-5-1': 'anthropic-claude-fable-5.1.md',
};
const RULE_CACHE = new Map();
async function rulesFor(model) {
  const file = RULE_FILE_BY_MODEL[model];
  if (!file) throw new Error(`No model-specific rule for "${model}"`);
  if (!RULE_CACHE.has(file)) RULE_CACHE.set(file, (await readFile(path.join(HERE, '../rules', file), 'utf8')).trim());
  return RULE_CACHE.get(file);
}
const QUICK = (await readFile(path.join(HERE, '../skills/quick/SKILL.md'), 'utf8')).split('<!-- no-overthink -->')[1].trim();

const ARMS = {
  without: { rules: false, quick: false, effort: undefined },
  with: { rules: true, quick: false, effort: undefined },
  quick: { rules: true, quick: true, effort: 'low' },
};

const MAX_TURNS = 30;
const MAX_TOKENS = 32000;
const SYSTEM =
  'You are a coding agent working in a local project directory. Use the tools to inspect and change files and to run shell commands. Paths are relative to the project root. When you have handled the request, reply to the user.';

const TOOLS = [
  {
    name: 'list_files',
    description: 'List files in a directory, recursively. Skips node_modules and .git.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory relative to the project root. Defaults to ".".' } },
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'write_file',
    description: 'Create a file or replace its whole content.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace exactly one occurrence of old_text with new_text in a file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'bash',
    description: 'Run a shell command in the project root. Returns the exit code and combined output.',
    input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
  },
];

// Commands the benchmark never needs: network, installs, privilege, pushing.
const DENY = /(^|[\s;&|(])(sudo|curl|wget|ssh|scp|npx|yarn|pnpm|brew)(\s|$)|git\s+push|npm\s+(i|install|publish|ci)(\s|$)/;

const { values: opts } = parseArgs({
  options: {
    models: { type: 'string', default: 'claude-opus-5-5,claude-fable-5-1' },
    arms: { type: 'string', default: 'without,with' },
    tasks: { type: 'string', default: tasks.map((t) => t.id).join(',') },
    reps: { type: 'string', default: '3' },
    concurrency: { type: 'string', default: '4' },
    effort: { type: 'string' },
    out: { type: 'string' },
  },
});

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error('Set ANTHROPIC_API_KEY first.');
  process.exit(1);
}

const models = opts.models.split(',').filter(Boolean);
const arms = opts.arms.split(',').filter(Boolean);
for (const arm of arms) if (!ARMS[arm]) throw new Error(`Unknown arm "${arm}". Use: ${Object.keys(ARMS).join(', ')}`);
const selected = opts.tasks.split(',').map((id) => {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Unknown task "${id}"`);
  return task;
});
const reps = Number(opts.reps);
const out = opts.out ?? path.join(HERE, 'results', `${new Date().toISOString().slice(0, 10)}.jsonl`);
await mkdir(path.dirname(out), { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callApi(body) {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    const started = performance.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (res.ok) return { response: await res.json(), ms: performance.now() - started, waited };
    const detail = await res.text();
    if ([429, 500, 502, 503, 504, 529].includes(res.status) && attempt < 6) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = (retryAfter > 0 ? retryAfter : 2 ** attempt * 2) * 1000;
      waited += delay;
      await sleep(delay);
      continue;
    }
    throw new Error(`API ${res.status}: ${detail.slice(0, 400)}`);
  }
}

function inside(dir, p = '.') {
  const resolved = path.resolve(dir, p);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) throw new Error(`Path is outside the project: ${p}`);
  return resolved;
}

function sh(command, dir, timeout = 60000) {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: dir, timeout, maxBuffer: 1 << 20, shell: '/bin/bash', env: { PATH: process.env.PATH, HOME: dir, LANG: 'en_US.UTF-8' } },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

async function listFiles(root, rel = '.') {
  const found = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(path.relative(root, full));
    }
  };
  await walk(inside(root, rel));
  return found.sort().join('\n') || '(empty)';
}

const clip = (text, max = 8000) => (text.length > max ? `${text.slice(0, max)}\n[truncated ${text.length - max} chars]` : text);

async function runTool(name, input, dir) {
  switch (name) {
    case 'list_files':
      return listFiles(dir, input.path);
    case 'read_file':
      return clip(await readFile(inside(dir, input.path), 'utf8'), 20000);
    case 'write_file': {
      const file = inside(dir, input.path);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, input.content);
      return `Wrote ${input.path}`;
    }
    case 'edit_file': {
      const file = inside(dir, input.path);
      const text = await readFile(file, 'utf8');
      const count = text.split(input.old_text).length - 1;
      if (count !== 1) throw new Error(`old_text matched ${count} times in ${input.path}; it must match exactly once`);
      await writeFile(file, text.replace(input.old_text, () => input.new_text));
      return `Edited ${input.path}`;
    }
    case 'bash': {
      if (DENY.test(input.command)) throw new Error('That command is not available in this sandbox.');
      const result = await sh(input.command, dir);
      return clip(`exit code: ${result.code}\n${result.stdout}${result.stderr}`);
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function firstMessage(task, arm, rules) {
  let text = task.prompt;
  if (arm.quick) text = `${QUICK}\n\n${text}`;
  if (arm.rules) text = `<system-reminder>\nThe model-specific instructions for this model:\n\n${rules}\n</system-reminder>\n\n${text}`;
  return text;
}

async function runAgent(model, arm, task, dir, rules) {
  const messages = [{ role: 'user', content: firstMessage(task, arm, rules) }];
  const m = { turns: 0, toolCalls: 0, input: 0, output: 0, thinking: 0, cacheRead: 0, cacheWrite: 0, apiMs: 0, waitedMs: 0 };
  const trace = [];
  const stops = [];
  let text = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const body = { model, max_tokens: MAX_TOKENS, thinking: { type: 'adaptive' }, system: SYSTEM, tools: TOOLS, messages };
    const effort = arm.effort ?? opts.effort;
    if (effort) body.output_config = { effort };
    const { response, ms, waited } = await callApi(body);
    const usage = response.usage ?? {};
    m.turns++;
    m.apiMs += ms;
    m.waitedMs += waited;
    m.input += usage.input_tokens ?? 0;
    m.output += usage.output_tokens ?? 0;
    m.thinking += usage.output_tokens_details?.thinking_tokens ?? 0;
    m.cacheRead += usage.cache_read_input_tokens ?? 0;
    m.cacheWrite += usage.cache_creation_input_tokens ?? 0;
    stops.push(response.stop_reason);
    messages.push({ role: 'assistant', content: response.content });

    const said = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (said) text = said;
    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || calls.length === 0) break;

    const results = await Promise.all(
      calls.map(async (call) => {
        m.toolCalls++;
        trace.push(`${call.name} ${call.input.path ?? call.input.command ?? ''}`.trim());
        try {
          return { type: 'tool_result', tool_use_id: call.id, content: String(await runTool(call.name, call.input, dir)) };
        } catch (error) {
          return { type: 'tool_result', tool_use_id: call.id, content: `Error: ${error.message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: 'user', content: results });
  }
  return { m, text, trace, stops };
}

async function runJob({ model, task, armName, rep }) {
  const arm = ARMS[armName];
  const dir = await mkdtemp(path.join(tmpdir(), `nobench-${task.id}-`));
  const checkDir = await mkdtemp(path.join(tmpdir(), 'nobench-check-'));
  const effort = arm.effort ?? opts.effort ?? 'default';
  const rules = await rulesFor(model);
  const rulesSha = createHash('sha256').update(rules).digest('hex').slice(0, 12);
  const record = { model, arm: armName, effort, task: task.id, kind: task.kind, rep, rules_sha: rulesSha, at: new Date().toISOString() };
  try {
    const fixture = path.join(HERE, 'fixtures', task.fixture);
    await cp(fixture, dir, { recursive: true });
    const started = performance.now();
    const { m, text, trace, stops } = await runAgent(model, arm, task, dir, rules);
    const wallMs = performance.now() - started - m.waitedMs;
    const pristine = async (testFile) => {
      const copy = path.join(dir, path.dirname(testFile), `__pristine__${path.basename(testFile)}`);
      await mkdir(path.dirname(copy), { recursive: true });
      await cp(path.join(fixture, testFile), copy);
      const result = await sh(`node --test ${JSON.stringify(path.relative(dir, copy))}`, dir);
      await rm(copy, { force: true });
      return result;
    };
    const nodeCheck = async (code) => {
      const file = path.join(checkDir, 'check.mjs');
      const prelude = `import assert from 'node:assert/strict';\nimport { pathToFileURL } from 'node:url';\nconst load = (p) => import(pathToFileURL(${JSON.stringify(dir)} + '/' + p).href);\n`;
      await writeFile(file, prelude + code);
      return sh(`node ${JSON.stringify(file)}`, dir);
    };
    const pass = await task.check({ dir, text, sh: (command) => sh(command, dir), nodeCheck, pristine });
    Object.assign(record, {
      pass: Boolean(pass),
      turns: m.turns,
      tool_calls: m.toolCalls,
      input_tokens: m.input,
      output_tokens: m.output,
      thinking_tokens: m.thinking,
      cache_read_tokens: m.cacheRead,
      cache_write_tokens: m.cacheWrite,
      api_ms: Math.round(m.apiMs),
      wall_ms: Math.round(wallMs),
      reply_chars: text.length,
      stop_reasons: stops,
      trace,
      reply: text.slice(0, 4000),
    });
  } catch (error) {
    record.error = error.message;
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(checkDir, { recursive: true, force: true });
  }
  await appendFile(out, `${JSON.stringify(record)}\n`);
  return record;
}

const jobs = [];
for (let rep = 1; rep <= reps; rep++)
  for (const task of selected) for (const model of models) for (const armName of arms) jobs.push({ model, task, armName, rep });

let done = 0;
let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    const r = await runJob(job);
    done++;
    const status = r.error ? `ERROR ${r.error}` : `${r.pass ? 'pass' : 'FAIL'} out=${r.output_tokens} think=${r.thinking_tokens} tools=${r.tool_calls} ${(r.wall_ms / 1000).toFixed(1)}s`;
    console.log(`[${done}/${jobs.length}] ${r.model} ${r.arm}@${r.effort} ${r.task} #${r.rep} ${status}`);
  }
};
console.log(`${jobs.length} runs -> ${path.relative(process.cwd(), out)} (model-specific rules)`);
await Promise.all(Array.from({ length: Math.min(Number(opts.concurrency), jobs.length) }, worker));
