#!/usr/bin/env pwsh
# no-overthink: installs separate, self-gated model rules and a /quick skill for
# Kiro (IDE, CLI, Kiro Crew), Claude Code, Codex, Cursor and Antigravity.
#
# Native Windows (PowerShell 7+) port of install.sh.
#
#   ./install.ps1                        install for every tool found on this machine
#   ./install.ps1 -Only kiro,claude      install for specific tools (kiro, claude, codex, cursor, antigravity)
#   ./install.ps1 -Agent tech-cofounder  also add the rules to these Kiro CLI custom agents
#   ./install.ps1 -Uninstall             remove everything this script added
#   ./install.ps1 -DryRun                show what would change
#
# Also works when fetched over the web:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/AlleyBo55/no-overthink/main/install.ps1))) -Only kiro

[CmdletBinding()]
param(
  [string]$Only = '',
  [string]$Agent = '',
  [switch]$Uninstall,
  [switch]$DryRun,
  [Alias('h')][switch]$Help
)

$ErrorActionPreference = 'Stop'

function Show-Usage {
  @'
no-overthink installer (PowerShell)

  ./install.ps1                        install for every tool found on this machine
  ./install.ps1 -Only kiro,claude      install for specific tools (kiro, claude, codex, cursor, antigravity)
  ./install.ps1 -Agent tech-cofounder  also add the rules to these Kiro CLI custom agents
  ./install.ps1 -Uninstall             remove everything this script added
  ./install.ps1 -DryRun                show what would change
'@ | Write-Output
}

if ($Help) { Show-Usage; exit 0 }

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Error 'no-overthink: install.ps1 needs PowerShell 7+. Install from https://aka.ms/powershell, or run install.sh via Git Bash or WSL.'
  exit 1
}

$BaseUrl   = if ($env:NO_OVERTHINK_BASE_URL) { $env:NO_OVERTHINK_BASE_URL } else { 'https://raw.githubusercontent.com/AlleyBo55/no-overthink/main' }
$Tag        = '<!-- no-overthink -->'
$BlockStart = '<!-- no-overthink:start -->'
$BlockEnd   = '<!-- no-overthink:end -->'
$CodexDir   = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$Tools      = @('kiro', 'claude', 'codex', 'cursor', 'antigravity')
$AgyDir     = Join-Path $HOME '.gemini/config'
$RuleFiles  = @(
  'anthropic-claude-opus-5.5.md',
  'anthropic-claude-fable-5.1.md',
  'openai-gpt-6.md',
  'openai-gpt-5.6.md',
  'openai-gpt-5.5.md'
)
$LegacyKiroRule   = Join-Path $HOME '.kiro/steering/no-overthink.md'
$LegacyCursorRule = Join-Path $HOME '.cursor/rules/no-overthink.mdc'

# Kiro CLI custom agents skip ~/.kiro/steering in workspaces that set
# chat.disableInheritingDefaultResources (Kiro Crew sets it), so -Agent lists our files in the agent.
$AgentEntries = @(
  'file://~/.kiro/steering/no-overthink-anthropic-claude-opus-5.5.md',
  'file://~/.kiro/steering/no-overthink-anthropic-claude-fable-5.1.md',
  'file://~/.kiro/steering/no-overthink-openai-gpt-6.md',
  'file://~/.kiro/steering/no-overthink-openai-gpt-5.6.md',
  'file://~/.kiro/steering/no-overthink-openai-gpt-5.5.md',
  'skill://~/.kiro/skills/quick/SKILL.md'
)
$LegacyAgentEntries = @('file://~/.kiro/steering/no-overthink.md')

$action = if ($Uninstall) { 'uninstall' } else { 'install' }

$onlyList = @($Only -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($t in $onlyList) {
  if ($Tools -notcontains $t) { Write-Error "Unknown tool: $t (use: $($Tools -join ', '))"; exit 2 }
}
$agentList = @($Agent -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
foreach ($a in $agentList) {
  if ($a -notmatch '^[A-Za-z0-9._-]+$') { Write-Error "Bad agent name: $a"; exit 2 }
}
# -Agent edits Kiro files, so it always includes Kiro.
if ($agentList.Count -gt 0 -and $onlyList.Count -gt 0 -and ($onlyList -notcontains 'kiro')) {
  $onlyList += 'kiro'
}

# Read sources from this checkout, or download them when fetched from the web.
$srcDir = ''
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { '' }
if ($scriptDir -and (Test-Path (Join-Path $scriptDir 'rules/anthropic-claude-opus-5.5.md'))) {
  $srcDir = $scriptDir
}

function Fetch([string]$rel) {
  $c = if ($srcDir) {
    Get-Content -Raw -LiteralPath (Join-Path $srcDir $rel)
  } else {
    (Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/$rel").Content
  }
  # Match command-substitution semantics: normalize newlines, drop trailing blank lines.
  ($c -replace "`r`n", "`n").TrimEnd("`n")
}

function Say([string]$msg) { Write-Output $msg }
function Show([string]$path) {
  if ($path.StartsWith($HOME)) { '~' + ($path.Substring($HOME.Length) -replace '\\', '/') } else { $path }
}

# Write a file with LF endings and no BOM.
function Write-Text([string]$path, [string]$content) {
  $dir = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $normalized = $content -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText($path, $normalized, (New-Object System.Text.UTF8Encoding($false)))
}

function Contains-Marker([string]$path, [string]$marker) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  return [bool](Select-String -LiteralPath $path -SimpleMatch $marker -Quiet)
}

# Write a file we own. Never overwrite a file someone else created.
function Put([string]$path, [string]$content) {
  if ((Test-Path -LiteralPath $path) -and -not (Contains-Marker $path $Tag)) {
    Say "  skip $(Show $path): exists and was not created by no-overthink"
    return
  }
  if ($DryRun) { Say "  would write $(Show $path)"; return }
  Write-Text $path ($content + "`n")
  Say "  wrote $(Show $path)"
}

function Unput([string]$path) {
  if (-not (Contains-Marker $path $Tag)) { return }
  if ($DryRun) { Say "  would remove $(Show $path)"; return }
  Remove-Item -LiteralPath $path -Force
  $dir = Split-Path -Parent $path
  if ($dir -and (Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -Force -LiteralPath $dir)) {
    Remove-Item -LiteralPath $dir -Force -ErrorAction SilentlyContinue
  }
  Say "  removed $(Show $path)"
}

function Without-Block([string]$path) {
  $text = ([System.IO.File]::ReadAllText($path) -replace "`r`n", "`n").TrimEnd("`n")
  $out = foreach ($ln in ($text -split "`n")) {
    if ($ln -eq $BlockStart) { $skip = $true; continue }
    if ($ln -eq $BlockEnd)   { $skip = $false; continue }
    if (-not $skip) { $ln }
  }
  ($out -join "`n").TrimEnd("`n")
}

# Add or refresh our marked block at the end of a shared file (CLAUDE.md, AGENTS.md).
function Put-Block([string]$file, [string]$content) {
  if ($DryRun) { Say "  would update $(Show $file)"; return }
  $rest = if (Test-Path -LiteralPath $file) { Without-Block $file } else { '' }
  $sb = ''
  if ($rest -ne '') { $sb += $rest + "`n`n" }
  $sb += "$BlockStart`n$content`n$BlockEnd`n"
  Write-Text $file $sb
  Say "  updated $(Show $file)"
}

function Unput-Block([string]$file) {
  if (-not (Contains-Marker $file $BlockStart)) { return }
  if ($DryRun) { Say "  would update $(Show $file)"; return }
  $rest = Without-Block $file
  if ($rest.Trim() -eq '') {
    Remove-Item -LiteralPath $file -Force
    Say "  removed $(Show $file)"
  } else {
    Write-Text $file ($rest + "`n")
    Say "  updated $(Show $file)"
  }
}

function Patch-Agent([string]$name) {
  $file = Join-Path $HOME ".kiro/agents/$name.json"
  if (-not (Test-Path -LiteralPath $file)) { Say "  skip $(Show $file): not found"; return }
  $json = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json
  $hasResources = [bool]($json.PSObject.Properties.Name -contains 'resources')
  $current = if ($hasResources -and $json.resources) { @($json.resources) } else { @() }
  $remove = $AgentEntries + $LegacyAgentEntries
  $kept = @($current | Where-Object { $remove -notcontains $_ })
  $newResources = if ($action -eq 'install') { @($kept + $AgentEntries) } else { $kept }

  if (($current -join "`n") -eq ($newResources -join "`n")) {
    Say "  unchanged $(Show $file)"
    return
  }
  if ($DryRun) { Say "  would update $(Show $file)"; return }

  if ($newResources.Count -eq 0) {
    if ($hasResources) { $json.PSObject.Properties.Remove('resources') }
  } elseif ($hasResources) {
    $json.resources = [object[]]$newResources
  } else {
    $json | Add-Member -NotePropertyName resources -NotePropertyValue ([object[]]$newResources)
  }
  Write-Text $file (($json | ConvertTo-Json -Depth 50) + "`n")
  Say "  updated $(Show $file)"
}

function Selected([string]$tool, [string]$dir) {
  if ($onlyList.Count -gt 0) { return ($onlyList -contains $tool) }
  return (Test-Path -LiteralPath $dir)
}

if ($action -eq 'install') {
  $rulesBundle = ''
  foreach ($rf in $RuleFiles) {
    $rule = Fetch "rules/$rf"
    if ($rulesBundle -ne '') { $rulesBundle = "$rulesBundle`n`n---`n`n$rule" } else { $rulesBundle = $rule }
  }
  $skill = Fetch 'skills/quick/SKILL.md'
  # Claude Code extras: user-invoked only, and effort drops to low for that turn.
  $lines = $skill -split "`n"
  $done = $false
  $acc = foreach ($i in 0..($lines.Count - 1)) {
    $ln = $lines[$i]
    if (-not $done -and $i -gt 0 -and $ln -eq '---') {
      'disable-model-invocation: true'
      'argument-hint: <request>'
      'effort: low'
      $done = $true
    }
    $ln
  }
  $claudeSkill = ($acc -join "`n") + "`n`n" + '$ARGUMENTS'
}

Say "no-overthink: $action$(if ($DryRun) { ' (dry run)' })"
$count = 0

if (Selected 'kiro' (Join-Path $HOME '.kiro')) {
  $count++
  Say 'Kiro (IDE, CLI, Kiro Crew)'
  if ($action -eq 'install') {
    # Remove the former global rule so only self-gated model rules remain.
    Unput $LegacyKiroRule
    foreach ($rf in $RuleFiles) {
      $rule = Fetch "rules/$rf"
      Put (Join-Path $HOME ".kiro/steering/no-overthink-$rf") "---`ninclusion: always`n---`n$Tag`n`n$rule"
    }
    Put (Join-Path $HOME '.kiro/skills/quick/SKILL.md') $skill
  } else {
    Unput $LegacyKiroRule
    foreach ($rf in $RuleFiles) { Unput (Join-Path $HOME ".kiro/steering/no-overthink-$rf") }
    Unput (Join-Path $HOME '.kiro/skills/quick/SKILL.md')
    # Without -Agent, clean every agent that an earlier -Agent changed.
    if ($agentList.Count -eq 0) {
      $agentDir = Join-Path $HOME '.kiro/agents'
      if (Test-Path -LiteralPath $agentDir) {
        $found = Get-ChildItem -LiteralPath $agentDir -Filter *.json -ErrorAction SilentlyContinue |
          Where-Object { (Get-Content -Raw -LiteralPath $_.FullName) -match 'file://~/\.kiro/steering/no-overthink(\.md|-)' } |
          ForEach-Object { $_.BaseName }
        if ($found) { $agentList = @($found) }
      }
    }
  }
  foreach ($a in $agentList) { Patch-Agent $a }
}

if (Selected 'claude' (Join-Path $HOME '.claude')) {
  $count++
  Say 'Claude Code'
  if ($action -eq 'install') {
    Put-Block (Join-Path $HOME '.claude/CLAUDE.md') $rulesBundle
    Put (Join-Path $HOME '.claude/skills/quick/SKILL.md') $claudeSkill
  } else {
    Unput-Block (Join-Path $HOME '.claude/CLAUDE.md')
    Unput (Join-Path $HOME '.claude/skills/quick/SKILL.md')
  }
}

if (Selected 'codex' $CodexDir) {
  $count++
  Say 'Codex'
  if ($action -eq 'install') {
    Put-Block (Join-Path $CodexDir 'AGENTS.md') $rulesBundle
    Put (Join-Path $HOME '.agents/skills/quick/SKILL.md') $skill
    $override = Join-Path $CodexDir 'AGENTS.override.md'
    if ((Test-Path -LiteralPath $override) -and ((Get-Item -LiteralPath $override).Length -gt 0)) {
      Say "  note: $(Show $override) exists, so Codex ignores AGENTS.md until you remove it"
    }
  } else {
    Unput-Block (Join-Path $CodexDir 'AGENTS.md')
    Unput (Join-Path $HOME '.agents/skills/quick/SKILL.md')
  }
}

if (Selected 'cursor' (Join-Path $HOME '.cursor')) {
  $count++
  Say 'Cursor'
  if ($action -eq 'install') {
    # Remove the former global rule so only self-gated model rules remain.
    Unput $LegacyCursorRule
    foreach ($rf in $RuleFiles) {
      $stem = $rf -replace '\.md$', ''
      $rule = Fetch "rules/$rf"
      Put (Join-Path $HOME ".cursor/rules/no-overthink-$stem.mdc") "---`ndescription: Model-specific no-overthink rule for $stem`nalwaysApply: true`n---`n$Tag`n`n$rule"
    }
    Put (Join-Path $HOME '.cursor/skills/quick/SKILL.md') $skill
    Say '  note: if Cursor doesn''t list these rules, paste the files under rules/ into Settings > Rules > User Rules'
  } else {
    Unput $LegacyCursorRule
    foreach ($rf in $RuleFiles) {
      $stem = $rf -replace '\.md$', ''
      Unput (Join-Path $HOME ".cursor/rules/no-overthink-$stem.mdc")
    }
    Unput (Join-Path $HOME '.cursor/skills/quick/SKILL.md')
  }
}

# Antigravity (App, IDE, CLI) reads modular global rules from ~/.gemini/config/rules/*.md
# and global skills from ~/.gemini/config/skills/. Detect it by its own folders, not ~/.gemini,
# which Gemini CLI also uses.
$agySeen = Join-Path $HOME '.gemini/antigravity'
foreach ($d in @(
    (Join-Path $HOME '.gemini/antigravity'),
    (Join-Path $HOME '.gemini/antigravity-ide'),
    (Join-Path $HOME '.gemini/antigravity-cli')
  )) {
  if (Test-Path -LiteralPath $d) { $agySeen = $d; break }
}
if (Selected 'antigravity' $agySeen) {
  $count++
  Say 'Antigravity (App, IDE, CLI)'
  if ($action -eq 'install') {
    foreach ($rf in $RuleFiles) {
      $stem = $rf -replace '\.md$', ''
      $rule = Fetch "rules/$rf"
      Put (Join-Path $AgyDir "rules/no-overthink-$rf") "---`ntrigger: always_on`ndescription: Model-specific no-overthink rule for $stem`n---`n$Tag`n`n$rule"
    }
    Put (Join-Path $AgyDir 'skills/quick/SKILL.md') $skill
  } else {
    foreach ($rf in $RuleFiles) { Unput (Join-Path $AgyDir "rules/no-overthink-$rf") }
    Unput (Join-Path $AgyDir 'skills/quick/SKILL.md')
  }
}

if ($count -eq 0) {
  Say 'No supported tool found (~/.kiro, ~/.claude, ~/.codex, ~/.cursor, ~/.gemini/antigravity). Use -Only to pick tools anyway.'
  exit 1
}
if ($action -eq 'install') { Say 'Done. Start a new session in each tool to load the rules.' } else { Say 'Done.' }
