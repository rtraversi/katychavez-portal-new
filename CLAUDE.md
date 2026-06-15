# IurisIQ Portal Template — Project Instructions

**This is the IurisIQ reusable portal template.** Before starting work, read `new-client-setup.md` — it is the source of truth for architecture, module structure, and how to spin up a new client deployment.

## Hard rules
- **Stack:** Cloudflare Workers + Supabase + Cloudflare R2 (files) + Backblaze B2 (backup). No Netlify.
- **Serverless-first. No n8n, no VPS.** CF Workers handles all API routes.
- **Files live in R2**, never in the DB. DB holds metadata + pointers.
- **Branch per module** (`module/<name>`). Never push half-built work to master.
- **Migrations are the source of truth for DB schema** — never hand-edit the live database.
- **New modules built here first**, tested in sandbox, then deployed to client portals.

## Working rules
- When adding a module: append to `modules/registry.js`, add migration in the correct range, register routes in `_worker.js`.
- `wrangler.toml` is gitignored — it contains per-client credentials. Use `wrangler.toml.example` as the template.
- Run `node scripts/build-config.js` (with env vars) before every deploy to regenerate `js/config.js`.

## Module tier model
- **CORE** — always on, no DB gate needed (core, tasks, uploads, client_portal, doc_templates).
- **PREMIUM** — off by default; activated per firm via a row in `enabled_modules` table. Marked `premium: true` in `registry.js`.

## Sandbox deploy command
```
node -e "process.env.SUPABASE_URL='<url>'; process.env.SUPABASE_ANON_KEY='<key>'; process.env.FIRM_NAME='IurisIQ Sandbox'; require('./scripts/build-config.js')"
npx wrangler deploy
```
