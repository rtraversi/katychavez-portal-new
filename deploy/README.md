# deploy/ — per-client deployment artifacts

Everything under here is **client-specific and downstream of the template**. None of it
is part of the reusable portal. It lives in the template repo only because the sync
scripts copy files *from* this working copy into a client clone.

Moved here from the repo root in the 2026-07 consolidation
(see `CONSOLIDATION-ANALYSIS.md` §2) — root had accumulated 17 sync scripts and 14
client deploy docs, which made it hard to see what was actually template.

## Layout

| Directory | Client | Clone path | Supabase |
|---|---|---|---|
| `ssl/` | Scroggins & Savage | `C:\Sites\scrogginssavage` | `xdzgkagyfiauyfxbbdxv` |
| `kcl/` | Katy Chavez Law | `C:\Sites\katychavez` | `syqpooenhygbkedfthwe` |

## What's in a client directory

- **`*-sync*.ps1`** — one per feature batch. Backs up the client clone, copies a fixed
  file set from this repo at a given commit, then runs `npm test`. Each prints the DB
  step and deploy step; it does **not** deploy. Paths are hardcoded to the clone.
- **`*-DEPLOY*.md` / `*-PORT.md`** — the playbook that accompanied a batch: which
  migrations to apply, which secrets to set, what to verify afterwards.

## Not in git

Three files here are gitignored because they hold live per-client values and are
treated as throwaway (pasted into a client-rooted window, then discarded):

- `ssl/SCROGGINS-CLONE-DEPLOY.md`
- `kcl/KCL-SYNC-DEPLOY.md`
- `kcl/kcl-sync.ps1`

The old root paths are still listed in `.gitignore` alongside the new ones, so an
older working copy that hasn't picked up the move won't start tracking them.

## Rules

- **The template is upstream.** Fixes are made here, tested in sandbox, then synced
  out. Never copy a client-specific pattern back into the template.
- **Nothing in `deploy/` is loaded by the worker.** It's operator tooling only.
- A new client gets a new directory — don't generalize these scripts into one
  parameterized script until there's a third client to justify it.
