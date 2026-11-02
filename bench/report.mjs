#!/usr/bin/env node
// Summarizes bench results as markdown. One section per results file and model.
// Usage: node bench/report.mjs bench/results/*.jsonl
//
// Only paired runs count: a task repetition is included when every arm in the file finished it
// without an API error, so each arm is measured on exactly the same work.
// Question tasks are re-scored from the stored reply with the current check in tasks.mjs.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tasks as TASKS } from './tasks.mjs';

// USD per million tokens, list price. Runs don't use prompt caching, so cache tokens should be 0.
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-fable-5-1': { input: 10, output: 50 },
};
const ARM_ORDER = ['without', 'with', 'quick'];
const ARM_LABEL = { without: 'Without', with: 'With rules', quick: 'With rules + /quick' };

const cost = (r) => {
  const p = PRICES[r.model];
  if (!p) return NaN;
  return (r.input_tokens * p.input + r.output_tokens * p.output + r.cache_write_tokens * p.input * 1.25 + r.cache_read_tokens * p.input * 0.1) / 1e6;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => (xs.length ? sum(xs) / xs.length : NaN);
const int = (x) => Math.round(x).toLocaleString('en-US');
const pct = (x, base) => {
  const change = ((x - base) / base) * 100;
  return Number.isFinite(change) ? `${change > 0 ? '+' : ''}${Math.round(change)}%` : '';
};

function summarize(runs) {
  return {
    n: runs.length,
    pass: runs.filter((r) => r.pass).length,
    output: mean(runs.map((r) => r.output_tokens)),
    thinking: mean(runs.map((r) => r.thinking_tokens)),
    input: mean(runs.map((r) => r.input_tokens)),
    tools: mean(runs.map((r) => r.tool_calls)),
    seconds: mean(runs.map((r) => r.wall_ms / 1000)),
    cost: mean(runs.map(cost)),
    credits: mean(runs.map((r) => r.credits)),
    chars: mean(runs.map((r) => r.reply_chars)),
  };
}

const ROWS = [
  ['Tasks passed', (s) => `${s.pass}/${s.n}`, null],
  ['Output tokens per run', (s) => int(s.output), 'output'],
  ['…of which thinking', (s) => int(s.thinking), 'thinking'],
  ['Input tokens per run', (s) => int(s.input), 'input'],
  ['Tool calls per run', (s) => s.tools.toFixed(1), 'tools'],
  ['Time per run', (s) => `${s.seconds.toFixed(1)} s`, 'seconds'],
  ['Cost per run', (s) => `$${s.cost.toFixed(4)}`, 'cost'],
];
// Kiro CLI reports credits and events, not tokens (bench/kiro.mjs).
const KIRO_ROWS = [
  ['Tasks passed', (s) => `${s.pass}/${s.n}`, null],
  ['Kiro credits per run', (s) => s.credits.toFixed(3), 'credits'],
  ['Time per run', (s) => `${s.seconds.toFixed(1)} s`, 'seconds'],
  ['Tool calls per run', (s) => s.tools.toFixed(1), 'tools'],
  ['Final reply length', (s) => `${int(s.chars)} chars`, 'chars'],
];

const table = (header, body) => [
  `| ${header.join(' | ')} |`,
  `|${header.map((_, i) => (i ? ' ---: ' : ' --- ')).join('|')}|`,
  ...body.map((cells) => `| ${cells.join(' | ')} |`),
];

const lines = [];
let spent = 0;
let credits = 0;
for (const file of process.argv.slice(2)) {
  const all = (await readFile(file, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  spent += sum(all.filter((r) => !r.error && !r.tool).map(cost));
  credits += sum(all.filter((r) => !r.error && r.tool).map((r) => r.credits));

  for (const r of all) {
    const task = TASKS.find((t) => t.id === r.task);
    if (!r.error && task?.kind === 'question' && !r.pass) r.pass = Boolean(await task.check({ text: r.reply ?? '' }));
  }

  const group = (r) => (r.tool ? `Kiro CLI: ${r.agent} on ${r.model}` : r.model);
  for (const model of [...new Set(all.map(group))]) {
    const runs = all.filter((r) => group(r) === model);
    const kiro = Boolean(runs[0].tool);
    const arms = ARM_ORDER.filter((arm) => runs.some((r) => r.arm === arm));
    const key = (r) => `${r.task}#${r.rep}`;
    const complete = new Set(
      [...new Set(runs.map(key))].filter((k) => arms.every((arm) => runs.some((r) => key(r) === k && r.arm === arm && !r.error))),
    );
    const paired = runs.filter((r) => complete.has(key(r)) && !r.error);
    const stats = Object.fromEntries(arms.map((arm) => [arm, summarize(paired.filter((r) => r.arm === arm))]));
    const efforts = arms.map((arm) => `${ARM_LABEL[arm]} = ${runs.find((r) => r.arm === arm).effort}`).join(', ');
    const taskIds = TASKS.map((t) => t.id).filter((id) => paired.some((r) => r.task === id));

    lines.push(`### ${model}, ${path.basename(file, '.jsonl')}`, '');
    lines.push(
      `${complete.size} paired runs per arm over ${taskIds.length} tasks. Effort: ${efforts}. Rules version ${runs[0].rules_sha}.`,
      '',
    );

    const compare = arms.filter((a) => a !== 'without' && stats.without);
    const header = ['', ...arms.map((a) => ARM_LABEL[a]), ...compare.map((a) => `${ARM_LABEL[a]} vs without`)];
    const body = (kiro ? KIRO_ROWS : ROWS).map(([label, fmt, field]) => [
      label,
      ...arms.map((a) => fmt(stats[a])),
      ...compare.map((a) => (field ? pct(stats[a][field], stats.without[field]) : '')),
    ]);
    lines.push(...table(header, body), '');

    const failed = paired.filter((r) => !r.pass).map((r) => `${r.task} (${ARM_LABEL[r.arm]})`);
    if (failed.length) lines.push(`Failed checks: ${failed.join(', ')}.`, '');

    lines.push(`<details><summary>Per task: ${kiro ? 'credits' : 'output tokens'}, time, passed</summary>`, '');
    const taskBody = taskIds.map((id) => [
      id,
      ...arms.map((arm) => {
        const s = summarize(paired.filter((r) => r.arm === arm && r.task === id));
        const size = kiro ? `${s.credits.toFixed(2)} credits` : `${int(s.output)} tok`;
        return `${size} · ${s.seconds.toFixed(1)} s · ${s.pass}/${s.n}`;
      }),
    ]);
    lines.push(...table(['Task', ...arms.map((a) => ARM_LABEL[a])], taskBody), '', '</details>', '');
  }
}
const totals = [];
if (spent) totals.push(`API spend $${spent.toFixed(2)} at list price`);
if (credits) totals.push(`Kiro credits ${credits.toFixed(2)}`);
lines.push(`All completed runs in these files: ${totals.join(', ')}.`);
console.log(lines.join('\n'));
