#!/usr/bin/env bash
# no-overthink: installs separate, self-gated model rules and a /quick skill for
# Kiro (IDE, CLI, Kiro Crew), Claude Code, Codex, Cursor and Antigravity.
#
#   ./install.sh                         install for every tool found on this machine
#   ./install.sh --only kiro,claude      install for specific tools (kiro, claude, codex, cursor, antigravity)
#   ./install.sh --agent tech-cofounder  also add the rules to these Kiro CLI custom agents
#   ./install.sh --uninstall             remove everything this script added
#   ./install.sh --dry-run               show what would change
#
# Also works as: curl -fsSL https://raw.githubusercontent.com/AlleyBo55/no-overthink/main/install.sh | bash
set -euo pipefail

BASE_URL="${NO_OVERTHINK_BASE_URL:-https://raw.githubusercontent.com/AlleyBo55/no-overthink/main}"
TAG='<!-- no-overthink -->'
BLOCK_START='<!-- no-overthink:start -->'
BLOCK_END='<!-- no-overthink:end -->'
CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
TOOLS="kiro claude codex cursor antigravity"
AGY_DIR="$HOME/.gemini/config"
RULE_FILES="anthropic-claude-opus-5.5.md anthropic-claude-fable-5.1.md openai-gpt-6.md openai-gpt-5.6.md openai-gpt-5.5.md"
LEGACY_KIRO_RULE="$HOME/.kiro/steering/no-overthink.md"
LEGACY_CURSOR_RULE="$HOME/.cursor/rules/no-overthink.mdc"

action=install
only=""
agents=""
dry=0

usage() { sed -n '2,11p' "${BASH_SOURCE[0]:-/dev/null}" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) action=uninstall ;;
    --only) only="${2:-}"; shift ;;
    --only=*) only="${1#*=}" ;;
    --agent) agents="${2:-}"; shift ;;
    --agent=*) agents="${1#*=}" ;;
    --dry-run) dry=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

for tool in ${only//,/ }; do
  case " $TOOLS " in *" $tool "*) ;; *) echo "Unknown tool: $tool (use: ${TOOLS// /, })" >&2; exit 2 ;; esac
done
for agent in ${agents//,/ }; do
  case "$agent" in *[!A-Za-z0-9._-]*) echo "Bad agent name: $agent" >&2; exit 2 ;; esac
done
# --agent edits Kiro files, so it always includes Kiro.
if [ -n "$agents" ] && [ -n "$only" ]; then
  case ",$only," in *",kiro,"*) ;; *) only="$only,kiro" ;; esac
fi

# Read sources from this checkout, or download them when piped from curl.
src_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/rules/anthropic-claude-opus-5.5.md" ]; then
  src_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
fetch() {
  if [ -n "$src_dir" ]; then cat "$src_dir/$1"; else curl -fsSL "$BASE_URL/$1"; fi
}

say() { printf '%s\n' "$*"; }
show() { printf '%s' "${1/#$HOME/~}"; }

# Write a file we own. Never overwrite a file someone else created.
put() {
  local path="$1" content="$2"
  if [ -f "$path" ] && ! grep -qF "$TAG" "$path"; then
    say "  skip $(show "$path"): exists and was not created by no-overthink"
    return
  fi
  if [ "$dry" = 1 ]; then say "  would write $(show "$path")"; return; fi
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" >"$path"
  say "  wrote $(show "$path")"
}

unput() {
  local path="$1"
  [ -f "$path" ] && grep -qF "$TAG" "$path" || return 0
  if [ "$dry" = 1 ]; then say "  would remove $(show "$path")"; return; fi
  rm -f "$path"
  rmdir "$(dirname "$path")" 2>/dev/null || true
  say "  removed $(show "$path")"
}

without_block() {
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '$0 == s { skip = 1; next } $0 == e { skip = 0; next } !skip' "$1"
}

# Add or refresh our marked block at the end of a shared file (CLAUDE.md, AGENTS.md).
# Writes in place so symlinked dotfiles stay symlinks.
put_block() {
  local file="$1" content="$2" rest=""
  if [ "$dry" = 1 ]; then say "  would update $(show "$file")"; return; fi
  mkdir -p "$(dirname "$file")"
  [ -f "$file" ] && rest="$(without_block "$file")"
  {
    if [ -n "$rest" ]; then printf '%s\n\n' "$rest"; fi
    printf '%s\n%s\n%s\n' "$BLOCK_START" "$content" "$BLOCK_END"
  } >"$file.no-overthink.tmp"
  cat "$file.no-overthink.tmp" >"$file"
  rm -f "$file.no-overthink.tmp"
  say "  updated $(show "$file")"
}

unput_block() {
  local file="$1" rest
  [ -f "$file" ] && grep -qF "$BLOCK_START" "$file" || return 0
  if [ "$dry" = 1 ]; then say "  would update $(show "$file")"; return; fi
  rest="$(without_block "$file")"
  if [ -z "$(printf '%s' "$rest" | tr -d '[:space:]')" ]; then
    rm -f "$file"
    say "  removed $(show "$file")"
  else
    printf '%s\n' "$rest" >"$file"
    say "  updated $(show "$file")"
  fi
}

# Kiro CLI custom agents skip ~/.kiro/steering in workspaces that set
# chat.disableInheritingDefaultResources (Kiro Crew sets it), so --agent lists our files in the agent.
AGENT_ENTRIES='["file://~/.kiro/steering/no-overthink-anthropic-claude-opus-5.5.md","file://~/.kiro/steering/no-overthink-anthropic-claude-fable-5.1.md","file://~/.kiro/steering/no-overthink-openai-gpt-6.md","file://~/.kiro/steering/no-overthink-openai-gpt-5.6.md","file://~/.kiro/steering/no-overthink-openai-gpt-5.5.md","skill://~/.kiro/skills/quick/SKILL.md"]'
LEGACY_AGENT_ENTRIES='["file://~/.kiro/steering/no-overthink.md"]'
patch_agent() {
  local file="$HOME/.kiro/agents/$1.json" filter updated
  if [ ! -f "$file" ]; then
    say "  skip $(show "$file"): not found"
    return
  fi
  if ! command -v jq >/dev/null; then
    echo "--agent needs jq: https://jqlang.org/download/" >&2
    exit 1
  fi
  if [ "$action" = install ]; then
    filter='.resources = (((.resources // []) - $legacy - $entries) + $entries)'
  else
    filter='.resources = ((.resources // []) - $legacy - $entries) | if .resources == [] then del(.resources) else . end'
  fi
  updated="$(jq --argjson entries "$AGENT_ENTRIES" --argjson legacy "$LEGACY_AGENT_ENTRIES" "$filter" "$file")"
  if [ "$updated" = "$(jq . "$file")" ]; then
    say "  unchanged $(show "$file")"
  elif [ "$dry" = 1 ]; then
    say "  would update $(show "$file")"
  else
    printf '%s\n' "$updated" >"$file"
    say "  updated $(show "$file")"
  fi
}

selected() {
  if [ -n "$only" ]; then
    case ",$only," in *",$1,"*) return 0 ;; *) return 1 ;; esac
  fi
  [ -d "$2" ]
}

if [ "$action" = install ]; then
  rules_bundle=""
  for rule_file in $RULE_FILES; do
    rule="$(fetch "rules/$rule_file")"
    if [ -n "$rules_bundle" ]; then
      rules_bundle="$(printf '%s\n\n---\n\n%s' "$rules_bundle" "$rule")"
    else
      rules_bundle="$rule"
    fi
  done
  skill="$(fetch skills/quick/SKILL.md)"
  # Claude Code extras: user-invoked only, and effort drops to low for that turn.
  claude_skill="$(printf '%s\n' "$skill" | awk 'NR > 1 && /^---$/ && !done { print "disable-model-invocation: true"; print "argument-hint: <request>"; print "effort: low"; done = 1 } { print }')"
  claude_skill="$(printf '%s\n\n%s' "$claude_skill" '$ARGUMENTS')"
fi

say "no-overthink: $action$([ "$dry" = 1 ] && printf ' (dry run)')"
count=0

if selected kiro "$HOME/.kiro"; then
  count=$((count + 1))
  say "Kiro (IDE, CLI, Kiro Crew)"
  if [ "$action" = install ]; then
    # Remove the former global rule so only self-gated model rules remain.
    unput "$LEGACY_KIRO_RULE"
    for rule_file in $RULE_FILES; do
      rule="$(fetch "rules/$rule_file")"
      put "$HOME/.kiro/steering/no-overthink-$rule_file" "$(printf -- '---\ninclusion: always\n---\n%s\n\n%s' "$TAG" "$rule")"
    done
    put "$HOME/.kiro/skills/quick/SKILL.md" "$skill"
  else
    unput "$LEGACY_KIRO_RULE"
    for rule_file in $RULE_FILES; do
      unput "$HOME/.kiro/steering/no-overthink-$rule_file"
    done
    unput "$HOME/.kiro/skills/quick/SKILL.md"
    # Without --agent, clean every agent that an earlier --agent changed.
    [ -n "$agents" ] || agents="$(grep -lE 'file://~/.kiro/steering/no-overthink(\.md|-)' "$HOME"/.kiro/agents/*.json 2>/dev/null | sed 's|.*/||; s|\.json$||' | paste -sd, - || true)"
  fi
  for agent in ${agents//,/ }; do
    patch_agent "$agent"
  done
fi

if selected claude "$HOME/.claude"; then
  count=$((count + 1))
  say "Claude Code"
  if [ "$action" = install ]; then
    put_block "$HOME/.claude/CLAUDE.md" "$rules_bundle"
    put "$HOME/.claude/skills/quick/SKILL.md" "$claude_skill"
  else
    unput_block "$HOME/.claude/CLAUDE.md"
    unput "$HOME/.claude/skills/quick/SKILL.md"
  fi
fi

if selected codex "$CODEX_DIR"; then
  count=$((count + 1))
  say "Codex"
  if [ "$action" = install ]; then
    put_block "$CODEX_DIR/AGENTS.md" "$rules_bundle"
    put "$HOME/.agents/skills/quick/SKILL.md" "$skill"
    if [ -s "$CODEX_DIR/AGENTS.override.md" ]; then
      say "  note: $(show "$CODEX_DIR/AGENTS.override.md") exists, so Codex ignores AGENTS.md until you remove it"
    fi
  else
    unput_block "$CODEX_DIR/AGENTS.md"
    unput "$HOME/.agents/skills/quick/SKILL.md"
  fi
fi

if selected cursor "$HOME/.cursor"; then
  count=$((count + 1))
  say "Cursor"
  if [ "$action" = install ]; then
    # Remove the former global rule so only self-gated model rules remain.
    unput "$LEGACY_CURSOR_RULE"
    for rule_file in $RULE_FILES; do
      stem="${rule_file%.md}"
      rule="$(fetch "rules/$rule_file")"
      put "$HOME/.cursor/rules/no-overthink-$stem.mdc" "$(printf -- '---\ndescription: Model-specific no-overthink rule for %s\nalwaysApply: true\n---\n%s\n\n%s' "$stem" "$TAG" "$rule")"
    done
    put "$HOME/.cursor/skills/quick/SKILL.md" "$skill"
    say "  note: if Cursor doesn't list these rules, paste the files under rules/ into Settings > Rules > User Rules"
  else
    unput "$LEGACY_CURSOR_RULE"
    for rule_file in $RULE_FILES; do
      stem="${rule_file%.md}"
      unput "$HOME/.cursor/rules/no-overthink-$stem.mdc"
    done
    unput "$HOME/.cursor/skills/quick/SKILL.md"
  fi
fi

# Antigravity (App, IDE, CLI) reads modular global rules from ~/.gemini/config/rules/*.md
# and global skills from ~/.gemini/config/skills/. Detect it by its own folders, not ~/.gemini,
# which Gemini CLI also uses.
agy_seen="$HOME/.gemini/antigravity"
for d in "$HOME/.gemini/antigravity" "$HOME/.gemini/antigravity-ide" "$HOME/.gemini/antigravity-cli"; do
  if [ -d "$d" ]; then agy_seen="$d"; break; fi
done
if selected antigravity "$agy_seen"; then
  count=$((count + 1))
  say "Antigravity (App, IDE, CLI)"
  if [ "$action" = install ]; then
    for rule_file in $RULE_FILES; do
      stem="${rule_file%.md}"
      rule="$(fetch "rules/$rule_file")"
      put "$AGY_DIR/rules/no-overthink-$rule_file" "$(printf -- '---\ntrigger: always_on\ndescription: Model-specific no-overthink rule for %s\n---\n%s\n\n%s' "$stem" "$TAG" "$rule")"
    done
    put "$AGY_DIR/skills/quick/SKILL.md" "$skill"
  else
    for rule_file in $RULE_FILES; do
      unput "$AGY_DIR/rules/no-overthink-$rule_file"
    done
    unput "$AGY_DIR/skills/quick/SKILL.md"
  fi
fi

if [ "$count" = 0 ]; then
  say "No supported tool found (~/.kiro, ~/.claude, ~/.codex, ~/.cursor, ~/.gemini/antigravity). Use --only to pick tools anyway."
  exit 1
fi
[ "$action" = install ] && say "Done. Start a new session in each tool to load the rules." || say "Done."
