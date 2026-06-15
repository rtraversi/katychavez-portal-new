# IurisIQ Portal — New Client Setup Runbook

Complete guide for spinning up a new client deployment from this template.
Estimated time: 2–3 hours (most of which is waiting on account provisioning).

---

## Prerequisites

You need accounts for:
- **Cloudflare** (Workers + R2) — use your IurisIQ CF account
- **Supabase** — create a new org per client (Pro for production; free org fine for dev/sandbox)
- **Backblaze B2** — one bucket per client for file backup
- **Resend** — one domain per client for email notifications
- **attachmentAV** — one API key shared across all deployments (~€99/mo flat)
- **Anthropic** — one API key per client (Smart Intake AI feature)
- **iLovePDF** — one account per client (Doc Translations PDF export — premium module)

---

## Step 1 — Choose a client slug

Pick a short lowercase identifier: `smithlaw`, `joneslegal`, etc.
This slug becomes the worker name, R2 bucket name, and B2 bucket name.

```
CLIENT_SLUG = smithlaw
```

---

## Step 2 — Create Supabase project

1. Log into Supabase → New organization → name it `[Client Name]` (Pro for prod, free for dev)
2. Create project → name `[client-slug]-portal` → choose region closest to client
3. Save:
   - Project URL: `https://[ref].supabase.co`
   - Anon key (public) — goes into `wrangler.toml` and `.env`
   - Service role key (secret) — goes into `wrangler secret put SUPABASE_SERVICE_KEY`
   - DB password — needed for direct psql access

---

## Step 3 — Apply database migrations

In the Supabase SQL editor, run each file **in order**:

```
001_core_tables.sql
002_rbac.sql
003_rls_policies.sql
004_client_card_full.sql
005_client_portal.sql
006_client_self_service.sql
400_uploads_init.sql
401_uploads_cron_cleanup.sql
402_ssn_encryption.sql
403_malware_scanning.sql
500_esign_init.sql
501_esign_access.sql
502_esign_paralegal_write.sql
600_conflict_checker.sql
700_attorney_color.sql
800_messaging.sql
901_doc_discovery.sql
902_doc_template_case_types.sql
950_dashboard.sql
1000_calendar_oauth.sql
1001_calendar_key_dates.sql
1002_calendar_outlook_provider.sql
1003_messaging_debounced_notifications.sql
1050_enabled_modules.sql
```

After applying 1050, seed the premium modules this client has purchased:

```sql
-- Enable only the modules the client is paying for
INSERT INTO public.enabled_modules (module_key) VALUES
  ('messaging'),
  ('esign'),
  ('conflict_checker'),
  ('calendar')
  -- add more as needed: 'billing', 'translation', 'signature_stamp', etc.
ON CONFLICT DO NOTHING;
```

Update `supabase/migrations/applied-prod.txt` with all applied migration filenames.

---

## Step 4 — Create Cloudflare R2 bucket

1. Cloudflare dashboard → R2 → Create bucket
2. Name: `[client-slug]-portal-prod`
3. Set CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://[client-slug].[your-cf-subdomain].workers.dev", "https://[client-domain.com]"],
    "AllowedMethods": ["GET", "PUT", "DELETE"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Create an R2 API token (Account → R2 → Manage R2 API Tokens) with read+write on this bucket.
   Save: Access Key ID + Secret Access Key.

---

## Step 5 — Create Backblaze B2 bucket

1. B2 dashboard → Create Bucket → `[client-slug]-portal-backup` → Private
2. Create Application Key scoped to this bucket.
   Save: Key ID + Application Key.

---

## Step 6 — Set up Resend domain

1. Resend dashboard → Domains → Add domain → `[clientdomain.com]`
2. Add the DNS records Resend provides (DKIM, SPF, DMARC)
3. Wait for verification (5–30 min)
4. The from address will be `portal@[clientdomain.com]`

---

## Step 7 — Configure `wrangler.toml`

```bash
cp wrangler.toml.example wrangler.toml
```

Open `wrangler.toml` and fill in every placeholder. Key values:

| Var | Value |
|---|---|
| `name` | `[client-slug]` |
| `SUPABASE_URL` | From Step 2 |
| `SUPABASE_ANON_KEY` | From Step 2 |
| `R2_ACCOUNT_ID` | Your CF account ID |
| `R2_BUCKET_NAME` | `[client-slug]-portal-prod` |
| `PORTAL_URL` | `https://[client-slug].[subdomain].workers.dev` (or custom domain) |
| `PORTAL_FIRM_NAME` | Client's firm name |
| `PORTAL_FROM_EMAIL` | `portal@[clientdomain.com]` |
| `B2_BUCKET_NAME` | `[client-slug]-portal-backup` |
| `GOOGLE_REDIRECT_URI` | `[PORTAL_URL]/api/calendar/oauth-callback` |
| `OUTLOOK_REDIRECT_URI` | `[PORTAL_URL]/api/calendar/outlook-oauth-callback` |

---

## Step 8 — Build `js/config.js`

```powershell
node -e "process.env.SUPABASE_URL='https://[ref].supabase.co'; process.env.SUPABASE_ANON_KEY='[anon-key]'; process.env.FIRM_NAME='[Firm Name]'; require('./scripts/build-config.js')"
```

---

## Step 9 — Set secrets

```bash
npx wrangler secret put SUPABASE_SERVICE_KEY
npx wrangler secret put SSN_ENCRYPTION_KEY       # generate: openssl rand -hex 16
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put B2_KEY_ID
npx wrangler secret put B2_APPLICATION_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ATTACHMENTAV_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
# If using Google Calendar:
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# If using Outlook Calendar:
npx wrangler secret put OUTLOOK_CLIENT_ID
npx wrangler secret put OUTLOOK_CLIENT_SECRET
# If using Doc Translations module:
npx wrangler secret put ILOVEAPI_PROJECT_ID
npx wrangler secret put ILOVEAPI_SECRET_KEY
```

---

## Step 10 — Deploy

```bash
npx wrangler deploy
```

The worker URL will be `https://[client-slug].[your-cf-subdomain].workers.dev`.

---

## Step 11 — Create the first (Owner) user

1. Supabase dashboard → Authentication → Users → Invite user
2. Use the attorney/owner's email
3. After they accept, run this SQL to promote them to Owner role:

```sql
UPDATE public.users
SET role_id = (SELECT id FROM public.roles WHERE name = 'Owner')
WHERE email = 'owner@clientdomain.com';
```

4. Log in at `[PORTAL_URL]` to confirm access.

---

## Step 12 — Smoke test checklist

- [ ] Login works
- [ ] Clients page loads, can add a client
- [ ] Tasks page loads
- [ ] Document Intake: upload a test PDF — confirm it appears in R2 and DB
- [ ] Malware scan: upload EICAR test string as `.pdf` — should be rejected with friendly error
- [ ] E-sign: create a signature request, sign it
- [ ] Conflict check: run a check
- [ ] Messages: send a staff → client message, confirm email notification fires
- [ ] Calendar (if enabled): connect Google or Outlook OAuth

---

## Step 13 — Custom domain (optional)

1. Cloudflare dashboard → Workers & Pages → [worker name] → Custom Domains → Add
2. Enter `portal.[clientdomain.com]` (or whatever domain was agreed)
3. Update `PORTAL_URL` in `wrangler.toml` and redeploy
4. Update R2 CORS to allow the new domain
5. Update `GOOGLE_REDIRECT_URI` and `OUTLOOK_REDIRECT_URI` in `wrangler.toml` and redeploy

---

## Architecture reference

**Stack (locked):**
- Cloudflare Workers — app server + API routes (`_worker.js` router)
- Supabase — Postgres + Auth + RLS (one project per client, isolated)
- Cloudflare R2 — primary file storage (presigned PUT direct from browser)
- Backblaze B2 — nightly backup (different provider = real off-site copy)
- Resend — transactional email
- attachmentAV — malware scanning (Sophos engine, ISO 27001, GDPR)
- Anthropic — AI features (Smart Intake doc analysis, Doc Translations)

**Module system:**
- `modules/registry.js` — all modules listed here with `premium: true` flag where applicable
- `modules.tier` DB column + `enabled_modules` table — controls which premium modules are visible per firm
- Adding a module: add entry to `registry.js` + migration in correct range + routes in `_worker.js`

**Migration number ranges:**
| Range | Module |
|---|---|
| 001–099 | Core / RBAC / RLS |
| 400–499 | Uploads + document discovery |
| 500–599 | E-sign |
| 600–699 | Conflict checker |
| 700–799 | Attorney color coding |
| 800–899 | Messaging |
| 900–999 | Document discovery / templates |
| 1000–1099 | Calendar |
| 1050 | enabled_modules (tier model) |
| 1100–1199 | Billing |
| 1200–1299 | Document drafting (WebDAV) |
| 1300–1399 | Doc Translations |
| 1400–1499 | Signature Stamp |

**Key files:**
- `_worker.js` — CF Workers entry point + API router
- `modules/registry.js` — module registry (UI routing + premium flags)
- `js/menu.js` — sidebar nav renderer (checks role access + enabled_modules)
- `scripts/build-config.js` — generates `js/config.js` from env vars at build time
- `functions/api/` — all API route handlers
- `pages/[route]/` — each module's HTML + JS
