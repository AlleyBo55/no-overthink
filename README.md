# no-overthink

Always-on, model-specific rules and a `/quick` skill that reduce overthinking in Kiro, Kiro Crew, Claude Code, Codex and Cursor.

The installer deploys every supported rule together, but keeps each rule in a separate source file. Every file starts with an applicability gate: matching models apply it, while every other model ignores it. OpenAI GPT-6/6.1, GPT-5.6 and GPT-5.5 use the aggressive `strict-openai` profile; Claude Opus 5.5 and Claude Fable 5.1 keep their own Claude-specific profiles.

In the historical benchmark below, the earlier shared Claude rule cut output tokens by 41–57% and time per task by 30–53%. No task that passed without the rule failed with it. The split model-specific files have not yet been re-measured.

## Install

```bash
git clone https://github.com/AlleyBo55/no-overthink && cd no-overthink && ./install.sh
```

Or without cloning:

```bash
curl -fsSL https://raw.githubusercontent.com/AlleyBo55/no-overthink/main/install.sh | bash
```

Then start a new session in each tool.

| Option | Effect |
| --- | --- |
| `--only kiro,claude,codex,cursor` | Install for these tools only, even if their config folder doesn't exist yet |
| `--agent tech-cofounder` | Also add the rules to these Kiro CLI custom agents, comma-separated. See [Kiro CLI custom agents](#kiro-cli-custom-agents) |
| `--dry-run` | Print what would change |
| `--uninstall` | Remove everything the installer added |

## What gets installed

| Tool | Always-on rules | `/quick` skill |
| --- | --- | --- |
| Kiro IDE, Kiro CLI, Kiro Crew | separate `~/.kiro/steering/no-overthink-<model>.md` files | `~/.kiro/skills/quick/SKILL.md` |
| Claude Code | one marked block in `~/.claude/CLAUDE.md`, containing every separate rule | `~/.claude/skills/quick/SKILL.md` |
| Codex | one marked block in `~/.codex/AGENTS.md`, containing every separate rule | `~/.agents/skills/quick/SKILL.md` |
| Cursor | separate `~/.cursor/rules/no-overthink-<model>.mdc` files | `~/.cursor/skills/quick/SKILL.md` |

Without `--only`, the installer only sets up tools whose config folder exists. It never overwrites a file it didn't create, and it edits `CLAUDE.md` and `AGENTS.md` only between `<!-- no-overthink:start -->` and `<!-- no-overthink:end -->`. Running it again updates the files in place. Upgrading removes the former global `no-overthink` rule before installing the separate self-gated files.

If Cursor doesn't list the rules under Settings > Rules, paste every file under [`rules/`](rules) into User Rules. Cursor's help page lists `~/.cursor/rules` for local user rules, but older versions ignore that folder.

### Kiro CLI custom agents

Kiro CLI custom agents, such as kirobuff's `tech-cofounder`, load `~/.kiro/steering` only when the workspace inherits default resources. Kiro Crew turns inheritance off in the workspaces it manages (`chat.disableInheritingDefaultResources: true` in `.kiro/settings/cli.json`), so in those workspaces a custom agent gets only its own `resources`. Add the rules to the agent:

```bash
./install.sh --only kiro --agent tech-cofounder
```

This appends all five `file://~/.kiro/steering/no-overthink-<model>.md` resources and `skill://~/.kiro/skills/quick/SKILL.md` to the agent's `resources`. `--uninstall` removes both the current entries and the former global-rule entry from every agent that has them.

Checked with Kiro CLI 2.37.1 and Kiro Crew 0.12.0-rc.4:

- In a workspace that inherits, Kiro CLI still loads the rules once.
- Kiro Crew already gives custom agents the global steering, so `kirocrew chat --agent tech-cofounder` can receive a second copy when `--agent` also lists the files explicitly.

## Use

- The rules load in every session. Nothing to do.
- Type `/quick <request>` (Codex: `$quick <request>`) when one request should take the shortest path. In Claude Code the skill also lowers effort to `low` for that turn.

The rules live as separate files under [`rules/`](rules). The installer loads all five; each model applies only the file whose applicability gate names that model family.

## Model-specific rules

| Rule | Applies only to | Profile |
| --- | --- | --- |
| [`anthropic-claude-opus-5.5.md`](rules/anthropic-claude-opus-5.5.md) | Claude Opus 5.5 family | Claude-specific |
| [`anthropic-claude-fable-5.1.md`](rules/anthropic-claude-fable-5.1.md) | Claude Fable 5.1 family | Claude-specific |
| [`openai-gpt-6.md`](rules/openai-gpt-6.md) | OpenAI GPT-6 and GPT-6.1 variants | `strict-openai` |
| [`openai-gpt-5.6.md`](rules/openai-gpt-5.6.md) | OpenAI GPT-5.6 variants | `strict-openai` |
| [`openai-gpt-5.5.md`](rules/openai-gpt-5.5.md) | OpenAI GPT-5.5 variants | `strict-openai` |

The OpenAI range follows [OpenAI's current model catalog](https://developers.openai.com/api/docs/models) plus the two preceding stable GPT releases. The strict rules require immediate execution, one chosen solution, no visible deliberation, no scope expansion, one narrow verification, and a hard stop after the result. They do not apply to Claude or unidentified models.

| Surface | Setup |
| --- | --- |
| ChatGPT | Paste the matching `openai-*.md` file into [Custom Instructions](https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions-faq); for automatic model switching, paste all three and let the gates select |
| Codex | Run `./install.sh --only codex`; the marked `AGENTS.md` block contains every separate rule |
| OpenAI Responses API | Pass only the file matching the request's model through the `instructions` field |
| Other multi-model hosts | Install all files; the active model applies its matching file and ignores the rest |

If a host does not identify the active model to the model itself, every applicability gate instructs it to ignore the rule rather than risk applying another model's profile. The rules steer visible responses, tool use and task scope; they cannot override higher-priority instructions or disable private reasoning. Where supported, a lower [`reasoning.effort`](https://developers.openai.com/api/docs/guides/reasoning?api-mode=responses) provides a separate limit on reasoning cost and latency.

## Precedence

Every rule begins with a model-family gate. A nonmatching or unidentified model ignores the rest of that file. For a matching model, no-overthink takes priority over other user-controlled rules at the same instruction level. Each host's system, developer and safety hierarchy still wins, and stricter safety requirements always apply.

The strict OpenAI files block unsolicited tests, cleanup and refactors. They do not suppress checks explicitly required by the request or by a higher-priority project policy. Their verification rule removes redundant reruns after the required narrow check has passed.

## Lower effort as well

The rules change visible behavior. The effort setting controls how much private reasoning a model may use. OpenAI and Anthropic expose model-dependent effort controls; lower effort favors speed and cost, while higher effort remains useful for difficult work. Default effort is `medium` on Opus 5.5 and `high` on Fable 5.1.

| Tool | Lower effort |
| --- | --- |
| OpenAI Responses API | Set `reasoning: {"effort":"low"}` when the selected model supports it; accepted values are model-dependent ([docs](https://developers.openai.com/api/docs/guides/reasoning?api-mode=responses)) |
| Claude Code | `/effort medium` (saved per model), or `claude --effort low` for one session ([docs](https://code.claude.com/docs/en/model-config)) |
| Kiro CLI, Kiro Crew | `kiro-cli settings chat.modelDefaults '{"claude-opus-5.5":{"output_config":{"effort":"medium"}}}'`, or `kiro-cli chat --effort low` for one session |

A workspace-level `chat.modelDefaults` in `.kiro/settings/cli.json` overrides the global one, so check for it.

On the same 7 tasks without the rules, Opus 5.5 at `max` effort produced 5,001 output tokens and took 48.3 s per task. At its default effort it produced 685 tokens and took 8.5 s.

## Measurements

### Method

- **Harness:** [`bench/run.mjs`](bench/run.mjs) is a small coding-agent loop on the Anthropic Messages API with adaptive thinking and five tools: list, read, write and edit files, and bash.
- **Arms:**
  - *Without*: no rules, default effort.
  - *With rules*: the matching Claude model file under [`rules/`](rules) added to the first user message. Installed tools load every file, but only the matching model gate applies.
  - *With rules + /quick*: also the skill text, at effort `low`. This matches `/quick` in Claude Code.
- **Tasks:** 3 questions (undo a git commit, compare floats, explain a retry helper) and 5 code changes (fix a failing test, fix a crash, add a function, rename across files, fix an LRU cache). Every run starts from a fresh copy of its fixture in [`bench/fixtures`](bench/fixtures). A run passes when its check in [`bench/tasks.mjs`](bench/tasks.mjs) passes: the original tests, a hidden check, or a pattern in the answer.
- **When:** 2 November 2026, models `claude-opus-5-5` and `claude-fable-5-1`, historical shared-rules version `541dad574ed8`. Raw runs are in [`bench/results`](bench/results). The new model-specific files have not been re-measured; future runs record the hash of the rule selected for each model.

### Default effort

**Claude Opus 5.5:** 11 paired runs per arm over 8 tasks. Without and With rules ran at the model default (`medium`). With rules + /quick ran at `low`.

|  | Without | With rules | With rules + /quick | With rules vs without | With rules + /quick vs without |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tasks passed | 11/11 | 11/11 | 11/11 |  |  |
| Output tokens per run | 747 | 443 | 325 | -41% | -56% |
| …of which thinking | 31 | 3 | 0 | -89% | -100% |
| Input tokens per run | 3,462 | 4,052 | 3,958 | +17% | +14% |
| Tool calls per run | 1.9 | 1.7 | 1.6 | -10% | -14% |
| Time per run | 9.3 s | 6.5 s | 5.3 s | -30% | -43% |
| Cost per run | $0.0288 | $0.0251 | $0.0223 | -13% | -22% |

<details><summary>Per task: output tokens, time, passed</summary>

| Task | Without | With rules | With rules + /quick |
| --- | ---: | ---: | ---: |
| qa-git | 463 tok · 5.9 s · 2/2 | 97 tok · 2.5 s · 2/2 | 66 tok · 1.8 s · 2/2 |
| qa-float | 1,058 tok · 12.8 s · 2/2 | 611 tok · 6.5 s · 2/2 | 349 tok · 3.9 s · 2/2 |
| explain | 938 tok · 10.5 s · 2/2 | 429 tok · 7.0 s · 2/2 | 348 tok · 5.2 s · 2/2 |
| fix-test | 569 tok · 9.6 s · 1/1 | 503 tok · 9.6 s · 1/1 | 424 tok · 8.1 s · 1/1 |
| crash | 669 tok · 8.6 s · 1/1 | 478 tok · 6.7 s · 1/1 | 389 tok · 6.1 s · 1/1 |
| add-fn | 708 tok · 7.7 s · 1/1 | 454 tok · 6.6 s · 1/1 | 336 tok · 6.7 s · 1/1 |
| rename | 567 tok · 7.7 s · 1/1 | 528 tok · 8.6 s · 1/1 | 415 tok · 7.5 s · 1/1 |
| lru | 787 tok · 10.0 s · 1/1 | 636 tok · 7.4 s · 1/1 | 491 tok · 7.8 s · 1/1 |

</details>

**Claude Fable 5.1:** 11 paired runs per arm over 8 tasks. Without and With rules ran at the model default (`high`). With rules + /quick ran at `low`.

|  | Without | With rules | With rules + /quick | With rules vs without | With rules + /quick vs without |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tasks passed | 11/11 | 11/11 | 11/11 |  |  |
| Output tokens per run | 750 | 354 | 291 | -53% | -61% |
| …of which thinking | 44 | 0 | 0 | -100% | -100% |
| Input tokens per run | 4,754 | 4,765 | 4,856 | +0% | +2% |
| Tool calls per run | 2.6 | 1.8 | 1.7 | -31% | -34% |
| Time per run | 12.3 s | 8.0 s | 5.6 s | -35% | -55% |
| Cost per run | $0.0851 | $0.0653 | $0.0631 | -23% | -26% |

<details><summary>Per task: output tokens, time, passed</summary>

| Task | Without | With rules | With rules + /quick |
| --- | ---: | ---: | ---: |
| qa-git | 378 tok · 5.7 s · 2/2 | 66 tok · 1.8 s · 2/2 | 18 tok · 1.1 s · 2/2 |
| qa-float | 951 tok · 12.6 s · 2/2 | 411 tok · 5.8 s · 2/2 | 276 tok · 3.7 s · 2/2 |
| explain | 613 tok · 12.4 s · 2/2 | 261 tok · 8.3 s · 2/2 | 209 tok · 7.7 s · 2/2 |
| fix-test | 748 tok · 11.2 s · 1/1 | 446 tok · 7.9 s · 1/1 | 399 tok · 9.2 s · 1/1 |
| crash | 879 tok · 22.1 s · 1/1 | 405 tok · 7.4 s · 1/1 | 353 tok · 6.5 s · 1/1 |
| add-fn | 725 tok · 11.9 s · 1/1 | 575 tok · 14.5 s · 1/1 | 275 tok · 4.5 s · 1/1 |
| rename | 930 tok · 12.4 s · 1/1 | 476 tok · 13.6 s · 1/1 | 681 tok · 8.6 s · 1/1 |
| lru | 1,090 tok · 16.0 s · 1/1 | 514 tok · 12.7 s · 1/1 | 487 tok · 7.7 s · 1/1 |

</details>

### Opus 5.5 at max effort

7 paired runs per arm over 7 tasks (no `lru`). Both arms at `max`.

|  | Without | With rules | With rules vs without |
| --- | ---: | ---: | ---: |
| Tasks passed | 6/7 | 6/7 |  |
| Output tokens per run | 5,001 | 2,156 | -57% |
| …of which thinking | 3,432 | 1,418 | -59% |
| Input tokens per run | 17,829 | 10,966 | -38% |
| Tool calls per run | 8.0 | 4.7 | -41% |
| Time per run | 48.3 s | 22.6 s | -53% |
| Cost per run | $0.1713 | $0.0870 | -49% |

The `add-fn` run failed in both arms for the same reason: each run added a `slugify` test to the existing test file, and the harness version used for this run treated any edit to that file as a failure. The harness now runs the original tests instead, so adding tests passes and editing them still fails. These two runs need a rerun to be scored by the new check.

<details><summary>Per task: output tokens, time, passed</summary>

| Task | Without | With rules |
| --- | ---: | ---: |
| qa-git | 2,484 tok · 27.2 s · 1/1 | 316 tok · 4.2 s · 1/1 |
| qa-float | 11,689 tok · 103.7 s · 1/1 | 7,505 tok · 66.2 s · 1/1 |
| explain | 7,051 tok · 64.3 s · 1/1 | 1,233 tok · 13.9 s · 1/1 |
| fix-test | 1,929 tok · 21.1 s · 1/1 | 850 tok · 12.2 s · 1/1 |
| crash | 2,688 tok · 30.4 s · 1/1 | 1,057 tok · 12.9 s · 1/1 |
| add-fn | 5,705 tok · 58.7 s · 0/1 | 2,370 tok · 26.9 s · 0/1 |
| rename | 3,458 tok · 32.8 s · 1/1 | 1,759 tok · 21.6 s · 1/1 |

</details>

### Limits

- **Small sample.** Each arm has 1 run per code task and 2 per question, or 1 per task at max effort. The run stopped before the planned 3 repetitions because the API account ran out of credit. Treat the percentages as direction and size, not precise values.
- **A harness, not the tools themselves.** Claude Code, Kiro and Cursor send their own long system prompts, and some of those already ask for brevity, so the savings inside them may be smaller.
- **No prompt caching.** The rules add about 445 input tokens to every request, which is why input tokens rise for Opus at default effort. Real tools cache that prefix, and cached input costs about a tenth of the list price, so real costs fall more than shown here.
- **Small tasks only.** Pass rates held on these tasks. Long multistep work wasn't measured. If quality drops on hard work, keep the rules and use `/quick` less, or raise effort for that session.
- **One scoring fix.** Two correct `explain` answers wrote `baseMs * 2^attempt` instead of "exponential" and failed the first version of the check. The check now accepts that, and [`bench/report.mjs`](bench/report.mjs) re-scores stored answers with the current checks.

### Reproduce

Needs Node 22 or later and `ANTHROPIC_API_KEY`. The full matrix with 3 repetitions costs about $13 at list price, based on the costs above.

```bash
node bench/run.mjs --arms without,with,quick --reps 3
node bench/run.mjs --models claude-opus-5-5 --arms without,with --effort max --reps 3
node bench/report.mjs bench/results/*.jsonl
```

The agent runs code it writes on your machine, inside a temp copy of each fixture, with `HOME` set to that copy and no API keys in its environment.

## Files

| Path | Contents |
| --- | --- |
| [`rules/`](rules) | Separate, self-gated rules for each supported model family |
| [`skills/quick/SKILL.md`](skills/quick/SKILL.md) | The `/quick` skill |
| [`install.sh`](install.sh) | Installer and uninstaller |
| [`bench/`](bench) | API harness, Kiro CLI harness ([`kiro.mjs`](bench/kiro.mjs)), tasks, fixtures, raw results, report script |

## Sources

- OpenAI, [model catalog](https://developers.openai.com/api/docs/models) for the rolling GPT compatibility range, [reasoning models](https://developers.openai.com/api/docs/guides/reasoning?api-mode=responses) for model-dependent effort controls, and [ChatGPT Custom Instructions](https://help.openai.com/en/articles/8096356-chatgpt-custom-instructions-faq) for persistent ChatGPT setup.
- Anthropic, [Steering thinking](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost): effort is the main control for thinking, and system-prompt guidance can lower how often the model thinks.
- Anthropic, [Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5) and [Prompting Claude Fable 5.1](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1): the "answer directly without deliberating" wording, treating earlier answers as settled, batching independent tool calls, targeted edits instead of rewrites, and keeping changes and tests to what the task asks.
- Claude Code docs: [model configuration](https://code.claude.com/docs/en/model-config) for effort levels, and [skills](https://code.claude.com/docs/en/skills) for the `effort` and `disable-model-invocation` fields.
- Codex docs: [AGENTS.md](https://developers.openai.com/codex/guides/agents-md) for `~/.codex/AGENTS.md`, and [skills](https://learn.chatgpt.com/docs/build-skills) for `~/.agents/skills`.
- Cursor docs: [rules](https://cursor.com/help/customization/rules) for user rule files in `~/.cursor/rules`.
- Kiro Crew loading `~/.kiro/steering` was checked in the installed `kirocrew` 0.12.0-rc.4 package.
