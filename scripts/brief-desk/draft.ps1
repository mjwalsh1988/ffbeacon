# The local fallback for the Brief drafting run (plan section 8.1).
#
# Windows Task Scheduler runs this on the owner's machine when the cloud
# routine is not in use. It reads two environment variables from the task's
# own environment, never from .env.local:
#
#   BRIEF_DESK_TOKEN  the bearer token the two desk routes accept
#   SITE_URL          the site origin, for example https://ffbeacon.com
#
# It substitutes {SITE} into the bootstrap prompt (scripts/brief-desk/prompt.md)
# and runs `claude -p` with it. The token is NOT put into the prompt: the
# claude process inherits this shell's environment, and the prompt tells the
# run to read BRIEF_DESK_TOKEN from there at call time. The run holds no
# database credential of any kind; its only doors are the two HTTP routes.
#
# Task Scheduler action:
#   Program:   powershell.exe
#   Arguments: -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\ffbeacon\scripts\brief-desk\draft.ps1"
#   Set BRIEF_DESK_TOKEN and SITE_URL on the task's environment (or a wrapper),
#   never in this file and never in the repository.

$ErrorActionPreference = "Stop"

if (-not $env:BRIEF_DESK_TOKEN) {
    Write-Error "BRIEF_DESK_TOKEN is not set in the environment."
    exit 1
}
if (-not $env:SITE_URL) {
    Write-Error "SITE_URL is not set in the environment."
    exit 1
}

$site = $env:SITE_URL.TrimEnd("/")
$promptPath = Join-Path $PSScriptRoot "prompt.md"
if (-not (Test-Path $promptPath)) {
    Write-Error "Prompt file not found: $promptPath"
    exit 1
}

$prompt = (Get-Content -Path $promptPath -Raw -Encoding utf8).Replace("{SITE}", $site)

# The run identifies itself as the local path in the draft it submits.
$env:BRIEF_DESK_RUN_SOURCE = "local_run"

$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($null -eq $claude) {
    Write-Error "The claude CLI is not on PATH."
    exit 1
}

# WEB ONLY. NO SHELL. The run fetches third-party outlet pages for its research
# log, which is untrusted text arriving in the same context that holds whatever
# tools it has. A shell is a file read and write tool with no command filter, so
# `Bash` on this list meant a page could ask the run to read .env.local and post
# the contents somewhere, and the operator would see only a normal draft turn up
# in the moderation queue. "Never write to the repository" is a sentence in a
# prompt; the allow list is the control.
#
# WebFetch and WebSearch are enough: the two desk calls are HTTP, and the run
# makes them with WebFetch rather than curl.
& $claude.Source -p $prompt --allowedTools "WebFetch,WebSearch" --max-turns 200
exit $LASTEXITCODE
