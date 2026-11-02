#!/usr/bin/env node
// Measures the rules inside Kiro CLI with one of your own agents, for example kirobuff's
// tech-cofounder on Opus 5.5 at max effort. Each run gets a fresh copy of a task fixture and a
// workspace copy of the agent named "nobench". Resource inheritance is off, as in workspaces
// Kiro Crew manages, so the two arms differ only in the agent's resources:
//   without  the agent as configured, minus the entries install.sh --agent adds
//   with     the agent plus those entries: the rules and the /quick skill
// One JSON line per run is appended to the output file. Summarize with report.mjs.
//
// Usage: node bench/kiro.mjs [--agent tech-cofounder] [--model claude-opus-5.5] [--effort max]
//        [--tasks qa-git,qa-float,fix-test,add-fn] [--reps 2] [--concurrency 3] [--out file.jsonl]
//
// Uses your Kiro login and credits. The agent runs with --trust-all-tools inside a temp folder,
// without a sandbox, so use it only with the bundled tasks.

import { exec, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { tasks } from './tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULE_FILES = [
  'anthropic-claude-opus-5.5.md',
  'anthropic-claude-fable-5.1.md',
  'openai-gpt-6.md',
  'openai-gpt-5.6.md',
  'openai-gpt-5.5.md',
];
function ruleFileFor(model) {
  const id = model.split('/').at(-1);
  if (id.startsWith('claude-opus-5.5') || id.startsWith('claude-opus-5-5')) return 'anthropic-claude-opus-5.5.md';
  if (id.startsWith('claude-fable-5.1') || id.startsWith('claude-fable-5-1')) return 'anthropic-claude-fable-5.1.md';
  if (id.startsWith('gpt-6')) return 'openai-gpt-6.md';
  if (id.startsWith('gpt-5.6') || id.startsWith('gpt-5-6')) return 'openai-gpt-5.6.md';
  if (id.startsWith('gpt-5.5') || id.startsWith('gpt-5-5')) return 'openai-gpt-5.5.md';
  throw new Error(`No model-specific rule for "${model}"`);
}
const RULE_ENTRIES = RULE_FILES.map((file) => `file://~/.kiro/steering/no-overthink-${file}`);
const ENTRIES = [...RULE_ENTRIES, 'skill://~/.kiro/skills/quick/SKILL.md'];
const LEGACY_ENTRIES = ['file://~/.kiro/steering/no-overthink.md'];
const TIMEOUT_MS = 15 * 60 * 1000;
// The agent gets your environment minus credentials it doesn't need.
const ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|SECRET|TOKEN/i.test(key)));

const { values: opts } = parseArgs({
  options: {
    agent: { type: 'string', default: 'tech-cofounder' },
    model: { type: 'string', default: 'claude-opus-5.5' },
    effort: { type: 'string', default: 'max' },
    arms: { type: 'string', default: 'without,with' },
    tasks: { type: 'string', default: 'qa-git,qa-float,fix-test,add-fn' },
    reps: { type: 'string', default: '2' },
    concurrency: { type: 'string', default: '3' },
    out: { type: 'string' },
  },
});

const RULE_FILE = ruleFileFor(opts.model);
const RULES = (await readFile(path.join(HERE, '../rules', RULE_FILE), 'utf8')).trim();
const RULES_SHA = createHash('sha256').update(RULES).digest('hex').slice(0, 12);
const installedPath = path.join(homedir(), '.kiro/steering', `no-overthink-${RULE_FILE}`);
const installed = await readFile(installedPath, 'utf8').catch(() => '');
if (!installed.includes(RULES)) {
  console.error(`${installedPath} is missing or differs from rules/${RULE_FILE}. Run ./install.sh --only kiro first.`);
  process.exit(1);
}
const base = JSON.parse(await readFile(path.join(homedir(), '.kiro/agents', `${opts.agent}.json`), 'utf8'));
const arms = opts.arms.split(',').filter(Boolean);
for (const arm of arms) if (arm !== 'without' && arm !== 'with') throw new Error(`Unknown arm "${arm}". Use: without, with`);
const selected = opts.tasks.split(',').map((id) => {
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Unknown task "${id}"`);
  return task;
});
const out =
  opts.out ?? path.join(HERE, 'results', `${new Date().toISOString().slice(0, 10)}-kiro-${opts.agent}-${opts.effort}.jsonl`);
await mkdir(path.dirname(out), { recursive: true });

function agentFor(arm) {
  const kept = (base.resources ?? []).filter((entry) => !ENTRIES.includes(entry) && !LEGACY_ENTRIES.includes(entry));
  const agent = { ...base, name: 'nobench', resources: arm === 'with' ? [...kept, ...ENTRIES] : kept };
  // Keep tool guards. Drop hooks that write to your own state or terminal, and the shortcut.
  agent.hooks = base.hooks?.preToolUse ? { preToolUse: base.hooks.preToolUse } : undefined;
  delete agent.keyboardShortcut;
  return agent;
}

function sh(command, cwd, timeout = 60000) {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout, maxBuffer: 1 << 20, shell: '/bin/bash' }, (error, stdout, stderr) =>
      resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
}

function kiro(prompt, cwd) {
  const args = ['chat', '--agent', 'nobench', '--model', opts.model, '--effort', opts.effort];
  args.push('--trust-all-tools', '--output-format', 'stream-json', prompt);
  return new Promise((resolve) => {
    const child = spawn('kiro-cli', args, { cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// stream-json: metadata events carry credits and turn time, runFinished carries the final reply.
function parse(stdout) {
  const events = stdout.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const meta = events.filter((e) => e.type === 'metadata').map((e) => e.data ?? {});
  const finished = events.findLast((e) => e.type === 'runFinished')?.data ?? {};
  const calls = events
    .filter((e) => e.type === 'sessionUpdate')
    .map((e) => e.data?.update ?? e.data ?? {})
    .filter((u) => u.sessionUpdate === 'tool_call');
  const usage = meta.findLast((m) => m.meteringUsage)?.meteringUsage ?? [];
  return {
    credits: usage.reduce((total, u) => total + (u.value ?? 0), 0),
    turnMs: meta.findLast((m) => m.turnDurationMs)?.turnDurationMs,
    reasoning: meta.findLast((m) => m.reasoning)?.reasoning,
    trace: calls.map((c) => c.title),
    text: finished.finalText ?? '',
    status: finished.status,
    stopReason: finished.stopReason,
  };
}

async function runJob({ task, arm, rep }) {
  const dir = await mkdtemp(path.join(tmpdir(), `nokiro-${task.id}-`));
  const checkDir = await mkdtemp(path.join(tmpdir(), 'nokiro-check-'));
  const record = {
    tool: 'kiro-cli',
    agent: opts.agent,
    model: opts.model,
    effort: opts.effort,
    arm,
    task: task.id,
    kind: task.kind,
    rep,
    rules_sha: RULES_SHA,
    at: new Date().toISOString(),
  };
  try {
    const fixture = path.join(HERE, 'fixtures', task.fixture);
    await cp(fixture, dir, { recursive: true });
    await mkdir(path.join(dir, '.kiro/agents'), { recursive: true });
    await mkdir(path.join(dir, '.kiro/settings'), { recursive: true });
    await writeFile(path.join(dir, '.kiro/settings/cli.json'), `${JSON.stringify({ 'chat.disableInheritingDefaultResources': true }, null, 2)}\n`);
    await writeFile(path.join(dir, '.kiro/agents/nobench.json'), `${JSON.stringify(agentFor(arm), null, 2)}\n`);

    const started = performance.now();
    const result = await kiro(task.prompt, dir);
    const wallMs = performance.now() - started;
    const run = parse(result.stdout);
    if (!run.status) throw new Error(`kiro-cli exited ${result.code}: ${result.stderr.trim().slice(-400)}`);

    const pristine = async (testFile) => {
      const copy = path.join(dir, path.dirname(testFile), `__pristine__${path.basename(testFile)}`);
      await mkdir(path.dirname(copy), { recursive: true });
      await cp(path.join(fixture, testFile), copy);
      const checked = await sh(`node --test ${JSON.stringify(path.relative(dir, copy))}`, dir);
      await rm(copy, { force: true });
      return checked;
    };
    const nodeCheck = async (code) => {
      const file = path.join(checkDir, 'check.mjs');
      const prelude = `import assert from 'node:assert/strict';\nimport { pathToFileURL } from 'node:url';\nconst load = (p) => import(pathToFileURL(${JSON.stringify(dir)} + '/' + p).href);\n`;
      await writeFile(file, prelude + code);
      return sh(`node ${JSON.stringify(file)}`, dir);
    };
    const pass = await task.check({ dir, text: run.text, sh: (command) => sh(command, dir), nodeCheck, pristine });
    Object.assign(record, {
      pass: Boolean(pass),
      credits: run.credits,
      turn_ms: run.turnMs,
      wall_ms: Math.round(wallMs),
      tool_calls: run.trace.length,
      reply_chars: run.text.length,
      reasoning: run.reasoning,
      status: run.status,
      stop_reason: run.stopReason,
      trace: run.trace,
      reply: run.text.slice(0, 4000),
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
for (let rep = 1; rep <= Number(opts.reps); rep++) for (const task of selected) for (const arm of arms) jobs.push({ task, arm, rep });

let done = 0;
let next = 0;
const worker = async () => {
  while (next < jobs.length) {
    const job = jobs[next++];
    const r = await runJob(job);
    done++;
    const status = r.error
      ? `ERROR ${r.error}`
      : `${r.pass ? 'pass' : 'FAIL'} credits=${r.credits.toFixed(3)} tools=${r.tool_calls} ${(r.wall_ms / 1000).toFixed(1)}s`;
    console.log(`[${done}/${jobs.length}] ${opts.agent} ${opts.model}@${opts.effort} ${r.arm} ${r.task} #${r.rep} ${status}`);
  }
};
console.log(`${jobs.length} runs -> ${path.relative(process.cwd(), out)} (rules ${RULES_SHA})`);
await Promise.all(Array.from({ length: Math.min(Number(opts.concurrency), jobs.length) }, worker));
