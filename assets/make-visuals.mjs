// Draws the README images from the benchmark results: node assets/make-visuals.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tasks } from '../bench/tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Hero: each line's length is proportional to output tokens per task.
// Means from the Claude Opus 5.5 default-effort table in README.md (11 paired runs over 8 tasks).
const OPUS = { without: { tokens: 747, secs: 9.3 }, with: { tokens: 443, secs: 6.5 } };

// A looping path from A to B whose length is `ratio` times the straight distance.
function loopPath(A, B, ratio, loops = 4, steps = 320) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const ux = (B[0] - A[0]) / L;
  const uy = (B[1] - A[1]) / L;
  const T = 2 * Math.PI * loops;
  const a = L / T;
  const points = (r, n) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = (T * i) / n;
      const b = r * Math.sin((Math.PI * i) / n) ** 0.6;
      const u = a * t - b * Math.sin(t);
      const v = b * (1 - Math.cos(t));
      return [A[0] + u * ux + v * uy, A[1] + u * uy - v * ux];
    });
  const length = (p) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
  let lo = 0;
  let hi = 8 * a;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (length(points(mid, 4000)) / L < ratio) lo = mid;
    else hi = mid;
  }
  return 'M' + points((lo + hi) / 2, steps).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L');
}

{
  const W = 1280;
  const H = 640;
  const A = [140, 560];
  const B = [560, 420];
  const shift = 640;
  const loop = loopPath(A, B, OPUS.without.tokens / OPUS.with.tokens);
  const ends = (dx, color) => `<circle cx="${A[0] + dx}" cy="${A[1]}" r="9" fill="#f0f6fc"/>
<circle cx="${B[0] + dx}" cy="${B[1]}" r="9" fill="${color}"/>
<text x="${A[0] + dx - 18}" y="${A[1] + 6}" font-size="18" fill="#8b949e" text-anchor="end">ask</text>
<text x="${B[0] + dx}" y="${B[1] - 20}" font-size="18" fill="#8b949e" text-anchor="middle">answer</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
<title id="title">no-overthink: skip the detour</title>
<desc id="desc">Two paths from ask to answer, drawn to scale. Without rules the path loops and is ${OPUS.without.tokens} units long. With no-overthink it is straight and ${OPUS.with.tokens} units long. One unit is one output token: Claude Opus 5.5 at default effort, mean of 11 runs over 8 small coding tasks; 11 of 11 passed both ways.</desc>
<rect width="${W}" height="${H}" fill="#0d1117"/>
<g font-family="${SANS}">
<text x="80" y="128" font-size="76" font-weight="800" fill="#f0f6fc">no-overthink</text>
<text x="80" y="190" font-size="40" font-weight="700" fill="#7ee787">Skip the detour.</text>
<text x="80" y="236" font-size="24" fill="#8b949e">Always-on rules that cut overthinking in Claude and GPT coding agents.</text>
<text x="80" y="274" font-size="22" fill="#c9d1d9">Claude Code · Cursor · Kiro · Codex · Antigravity</text>
<line x1="640" y1="316" x2="640" y2="584" stroke="#30363d" stroke-width="2"/>
<text x="80" y="340" font-size="24" font-weight="700" fill="#f0f6fc">Without rules</text>
<text x="80" y="372" font-size="20" fill="#ffa198">${OPUS.without.tokens} output tokens · ${OPUS.without.secs} s</text>
<text x="720" y="340" font-size="24" font-weight="700" fill="#f0f6fc">With no-overthink</text>
<text x="720" y="372" font-size="20" fill="#7ee787">${OPUS.with.tokens} output tokens · ${OPUS.with.secs} s</text>
<path d="${loop}" fill="none" stroke="#ff7b72" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<line x1="${A[0] + shift}" y1="${A[1]}" x2="${B[0] + shift}" y2="${B[1]}" stroke="#7ee787" stroke-width="4" stroke-linecap="round"/>
${ends(0, '#ff7b72')}
${ends(shift, '#7ee787')}
<text x="640" y="618" font-size="16" fill="#8b949e" text-anchor="middle">Lines drawn to scale. Claude Opus 5.5, default effort, mean of 11 runs over 8 small coding tasks. 11/11 passed both ways.</text>
</g>
</svg>
`;
  writeFileSync(path.join(HERE, 'hero.svg'), svg);
}

// Before/after: two real replies to the same question, copied from the raw results.
{
  const runs = readFileSync(path.join(HERE, '../bench/results/2026-11-02-default-effort.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((r) => typeof r.output_tokens === 'number');
  const pick = (arm) => runs.find((r) => r.model === 'claude-fable-5-1' && r.task === 'qa-git' && r.rep === 1 && r.arm === arm);
  const before = pick('without');
  const after = pick('with');
  if (!before?.pass || !after?.pass) throw new Error('expected two passing qa-git replies');
  const prompt = tasks.find((t) => t.id === 'qa-git').prompt;

  // Markdown to plain text lines: code fences in monospace, bullets as dots, wrapped to `width` characters.
  const toLines = (md, width) => {
    const out = [];
    let code = false;
    for (const raw of md.split('\n')) {
      if (raw.startsWith('```')) {
        code = !code;
        continue;
      }
      if (code) {
        out.push({ text: raw, mono: true });
        continue;
      }
      if (!raw.trim()) {
        if (out.length && !out.at(-1).gap) out.push({ gap: true });
        continue;
      }
      let text = raw.replace(/\*\*/g, '').replace(/`/g, '');
      let indent = '';
      if (text.startsWith('- ')) {
        text = '• ' + text.slice(2);
        indent = '   ';
      }
      let line = '';
      for (const word of text.split(' ')) {
        if (line && (line + ' ' + word).length > width) {
          out.push({ text: line });
          line = indent + word;
        } else line = line ? line + ' ' + word : word;
      }
      out.push({ text: line });
    }
    return out;
  };

  const card = (x, y, w, title, run, color, extra = []) => {
    const pad = 28;
    const body = [];
    let cy = y + 108;
    for (const l of toLines(run.reply, 60)) {
      if (l.gap) {
        cy += 9;
        continue;
      }
      const style = l.mono ? `font-family="${MONO}" fill="#a5d6ff"` : 'fill="#c9d1d9"';
      body.push(`<text x="${x + pad}" y="${cy}" font-size="16" ${style} xml:space="preserve">${esc(l.text)}</text>`);
      cy += 23;
    }
    for (const line of extra) {
      cy += 16;
      body.push(`<text x="${x + pad}" y="${cy}" font-size="19" font-weight="700" fill="${color}">${esc(line)}</text>`);
      cy += 10;
    }
    const h = cy - y + 12;
    const stat = `${run.output_tokens} output tokens · ${(run.wall_ms / 1000).toFixed(1)} s · passed`;
    return {
      h,
      svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#161b22" stroke="${color}" stroke-width="2"/>
<text x="${x + pad}" y="${y + 46}" font-size="24" font-weight="700" fill="#f0f6fc">${esc(title)}</text>
<text x="${x + pad}" y="${y + 76}" font-size="18" fill="${color}">${esc(stat)}</text>
${body.join('\n')}`,
    };
  };

  const fewer = Math.round((1 - after.output_tokens / before.output_tokens) * 100);
  const top = 136;
  const left = card(40, top, 580, 'Without rules', before, '#ff7b72');
  const right = card(660, top, 580, 'With no-overthink', after, '#7ee787', [
    `This question: ${fewer}% fewer output tokens.`,
    'Average over all 8 tasks: 53% fewer.',
  ]);
  const W = 1280;
  const H = top + Math.max(left.h, right.h) + 64;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="title desc">
<title id="title">Same question, two real replies</title>
<desc id="desc">Claude Fable 5.1 answers "${esc(prompt)}" Without rules: ${before.output_tokens} output tokens in ${(before.wall_ms / 1000).toFixed(1)} s. With no-overthink: ${after.output_tokens} output tokens in ${(after.wall_ms / 1000).toFixed(1)} s. Both replies pass the check.</desc>
<rect width="${W}" height="${H}" fill="#0d1117"/>
<g font-family="${SANS}">
<text x="40" y="64" font-size="34" font-weight="800" fill="#f0f6fc">Same question. Two real replies.</text>
<text x="40" y="106" font-size="21" fill="#8b949e">“${esc(prompt)}”</text>
${left.svg}
${right.svg}
<text x="40" y="${H - 26}" font-size="16" fill="#8b949e">Claude Fable 5.1, default effort, run 1 of each. Text from bench/results, markdown shown as plain text.</text>
</g>
</svg>
`;
  writeFileSync(path.join(HERE, 'before-after.svg'), svg);
}
