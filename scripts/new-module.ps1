<#
.SYNOPSIS
  Scaffold a new module branch with all boilerplate: git branch, directories, JS stub,
  migration file, registry entry, and module spec sheet.

.USAGE
  .\scripts\new-module.ps1 -Name messaging

.DESCRIPTION
  Run from the repo root on the main branch. This script:
    1. Validates the module name against the registry
    2. Creates and checks out: module/<name> git branch
    3. Creates pages/<name>/index.html + <name>.js
    4. Creates functions/<name>/ directory
    5. Creates the first migration SQL in the module's number range
    6. Leaves a TODO in modules/registry.js to enable the module
    7. Creates _planning/modules/<name>-spec.md from template

  Module migration number ranges (locked  -  never change):
    billing     100-199  |  ai_brain    200-299  |  messaging   300-399
    uploads     400-499  |  esign       500-599  |  draft_forms 600-699
    dashboard   700-799  |  word_embed  800-899  |  (future     900-999)
#>

param(
  [Parameter(Mandatory)][string]$Name,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -- Validation ------------------------------------------------------------------

$VALID_MODULES = @{
  'billing'     = 100
  'ai_brain'    = 200
  'messaging'   = 300
  'uploads'     = 400
  'esign'       = 500
  'draft_forms' = 600
  'dashboard'   = 700
  'word_embed'  = 800
}

if (-not $VALID_MODULES.ContainsKey($Name)) {
  Write-Error "Unknown module '$Name'. Valid modules: $($VALID_MODULES.Keys -join ', ')"
  exit 1
}

$branchName = "module/$Name"
$migStart   = $VALID_MODULES[$Name]
$migFile    = "supabase/migrations/${migStart}_${Name}_init.sql"
$route      = $Name -replace '_', '-'
$nameWords  = $Name -replace '_', ' '
$titleCase  = (Get-Culture).TextInfo.ToTitleCase($nameWords)

# -- Check we're on main and working tree is clean -----------------------------

$currentBranch = git rev-parse --abbrev-ref HEAD
$validBases = @('main', 'master')
if ($currentBranch -notin $validBases) {
  if ($Force) {
    Write-Warning "You're on '$currentBranch', not main/master. Continuing because -Force was passed."
  } else {
    Write-Error "You're on '$currentBranch'. New module branches should be cut from main or master. Use -Force to override."
    exit 1
  }
}

$status = git status --porcelain
if ($status) {
  Write-Error "Working tree has uncommitted changes. Commit or stash before creating a new module."
  exit 1
}

# Check branch doesn't already exist
$existing = git branch --list $branchName
if ($existing) {
  Write-Error "Branch '$branchName' already exists."
  exit 1
}

Write-Host "Creating module: $Name" -ForegroundColor Cyan
Write-Host "  Branch: $branchName"
Write-Host "  Migration range: $migStart-$($migStart + 99)"
Write-Host ""

# -- Create git branch ---------------------------------------------------------

git checkout -b $branchName
Write-Host "[OK] Created branch $branchName" -ForegroundColor Green

# -- Create directories --------------------------------------------------------

New-Item -ItemType Directory -Force -Path "pages/$Name"       | Out-Null
New-Item -ItemType Directory -Force -Path "functions/$Name"   | Out-Null
New-Item -ItemType Directory -Force -Path "_planning/modules" | Out-Null
Write-Host "[OK] Created directories" -ForegroundColor Green

# -- Page HTML stub ------------------------------------------------------------

$pageHtml = @"
<!-- Module: $Name  -  loaded dynamically into #page-content by menu.js -->
<div class="page-header">
  <div>
    <h1 class="page-title">$titleCase</h1>
    <p class="page-subtitle" id="${Name}-subtitle"></p>
  </div>
  <div class="flex gap-3" id="${Name}-actions"></div>
</div>

<!-- TODO: build $titleCase module UI here -->
<div class="card">
  <p class="text-muted" style="text-align:center;padding:var(--space-10)">
    $titleCase module  -  under construction
  </p>
</div>
"@
Set-Content -Path "pages/$Name/index.html" -Value $pageHtml -Encoding utf8
Write-Host "[OK] Created pages/$Name/index.html" -ForegroundColor Green

# -- Page JS stub --------------------------------------------------------------

$funcName = $titleCase -replace ' ', ''
$migEnd   = $migStart + 99

$pageJs = @'
// Module: __NAME__ -- page logic.
// Migration range: __MIGSTART__--__MIGEND__.
// Branch: __BRANCH__
// Requires: db (supabase-client), Auth, Utils globals.
'use strict';

(async function __FUNCNAME__Page() {

  // TODO: implement __TITLECASE__ module

  const profile = await Auth.getProfile();
  console.log('[__NAME__] loaded, user:', profile?.email);

})();
'@ -replace '__NAME__',      $Name `
   -replace '__MIGSTART__',  $migStart `
   -replace '__MIGEND__',    $migEnd `
   -replace '__BRANCH__',    $branchName `
   -replace '__FUNCNAME__',  $funcName `
   -replace '__TITLECASE__', $titleCase

Set-Content -Path "pages/$Name/$Name.js" -Value $pageJs -Encoding utf8
Write-Host "[OK] Created pages/$Name/$Name.js" -ForegroundColor Green

# -- Functions placeholder -----------------------------------------------------

Set-Content -Path "functions/$Name/.gitkeep" -Value "" -Encoding utf8
Write-Host "[OK] Created functions/$Name/.gitkeep" -ForegroundColor Green

# -- Migration SQL stub --------------------------------------------------------

if (Test-Path $migFile) {
  Write-Warning "Migration file $migFile already exists  -  skipping."
} else {
  $migSql = @"
-- Migration ${migStart}: $titleCase module  -  initial schema
-- Module: $Name | Branch: $branchName
-- Number range for this module: ${migStart}-$($migStart + 99)
-- Apply AFTER migrations 001, 002, 003 (core schema + RBAC + RLS).
-- Next migration for this module: $($migStart + 1)_${Name}_<description>.sql

-- -- TABLES -------------------------------------------------------------------

-- TODO: add tables owned by the $Name module here.
-- Reminder: this module READS public.clients, public.matters, public.users (never ALTER them).
-- Example:
-- CREATE TABLE public.${Name}_example (
--   id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   matter_id  uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
--   created_at timestamptz NOT NULL DEFAULT now()
-- );

-- -- RLS ----------------------------------------------------------------------

-- TODO: enable RLS and add policies for your tables.
-- Use public.can_read('$Name') / public.can_write('$Name') / public.can_admin('$Name').
-- ALTER TABLE public.${Name}_example ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "${Name}_example_select" ON public.${Name}_example FOR SELECT USING (public.can_read('$Name'));
-- CREATE POLICY "${Name}_example_write"  ON public.${Name}_example FOR ALL    USING (public.can_write('$Name'));
"@
  Set-Content -Path $migFile -Value $migSql -Encoding utf8
  Write-Host "[OK] Created $migFile" -ForegroundColor Green
}

# -- Module spec sheet ---------------------------------------------------------

$specFile = "_planning/modules/${Name}-spec.md"
$specMd = @"
# Module Spec: $titleCase

> Auto-generated by new-module.ps1. Fill this in before building.
> One-pager per s.8 parallel build rules.

| Field | Value |
|---|---|
| **Switch key** | $Name |
| **Branch** | $branchName |
| **Migration range** | ${migStart}-$($migStart + 99) |
| **Wave** | 1 |
| **Status** | scaffolded |

## Tables OWNED (this module creates + migrates)
- (list tables here)

## Shared tables READ-ONLY (never ALTER)
- public.clients
- public.matters
- public.users
- public.documents (if relevant)
- public.tasks (if relevant)

## UI mount
- Nav route: `#$route`
- Page: `pages/$Name/index.html`
- JS: `pages/$Name/$Name.js`
- Functions: `functions/$Name/`

## Functions (Netlify)
- (list functions this module adds)

## Integration points
- (what other modules read from this module's tables)

## Open questions
- [ ] (list questions to resolve before/during build)
"@
Set-Content -Path $specFile -Value $specMd -Encoding utf8
Write-Host "[OK] Created $specFile" -ForegroundColor Green

# -- Summary -------------------------------------------------------------------

Write-Host ""
Write-Host "Module '$Name' scaffolded successfully." -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Fill in _planning/modules/${Name}-spec.md"
Write-Host "  2. Build pages/$Name/index.html + $Name.js"
Write-Host "  3. Add any Netlify functions to functions/$Name/"
Write-Host "  4. Write migrations in $migFile (range ${migStart}-$($migStart + 99))"
Write-Host "  5. When done: .\scripts\merge-module.ps1 -Name $Name"
Write-Host ""
Write-Host "The registry.js entry already exists  -  set comingSoon: false when the module is ready." -ForegroundColor Gray
