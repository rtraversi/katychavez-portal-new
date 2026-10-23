#!/usr/bin/env bash
# TEST ONLY. Checks migration 1627 (Drafter 1.0.4, a form on a case more than
# once) against a throwaway LOCAL Postgres database. Never point this at Supabase.
#
#   scripts/drafter-dbcheck/run.sh
#
# Creates a fresh database, applies the Proof Scan shim and the form filler
# chain up to 1626, loads legacy rows (before.sql), applies 1627 TWICE (it must
# be idempotent) and the G-1450 map amend, then prints what checks.sql finds.
# Every line must end in "true". Needs a local Postgres (Homebrew postgresql@16);
# set PGHOST/PGPORT for a server not on the default socket.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
DB="${DRAFTER_DBCHECK_DB:-drafter_1627_test}"

if ! command -v psql >/dev/null 2>&1 && [ -d /opt/homebrew/opt/postgresql@16/bin ]; then
  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
fi
unset PGSERVICE PGPASSWORD DATABASE_URL
export PGHOST="${PGHOST:-/tmp}"
export PGOPTIONS="-c client_min_messages=warning"

CHAIN=(
  001_core_tables.sql
  002_rbac.sql
  003_rls_policies.sql
  007_practice_areas.sql
  1511_form_filler_schema.sql
  1603-form-field-edits.sql
  1605-matter-forms.sql
  1600-g1450.sql
  1620_case_builder.sql
  1626_package_builder.sql
)

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
dropdb --if-exists "$DB" >/dev/null 2>&1
createdb "$DB"

"${PSQL[@]}" -f "$ROOT/scripts/proof-scan-v2-dbcheck/shim.sql" >/dev/null
for f in "${CHAIN[@]}"; do
  if ! out=$("${PSQL[@]}" -f "$MIGRATIONS/$f" 2>&1); then echo "MIGRATION FAILED: $f"; echo "$out"; exit 1; fi
done
"${PSQL[@]}" -f "$HERE/before.sql" >/dev/null
"${PSQL[@]}" -f "$MIGRATIONS/1627_matter_form_copies.sql" >/dev/null
"${PSQL[@]}" -f "$MIGRATIONS/1627_matter_form_copies.sql" >/dev/null
"${PSQL[@]}" -f "$MIGRATIONS/1600-g1450-fee-amount.sql" >/dev/null

out=$("${PSQL[@]}" -f "$HERE/checks.sql" 2>&1 | sed 's/^psql:.*NOTICE:  //')
echo "$out"
if echo "$out" | grep -q 'false'; then echo "FAILED"; exit 1; fi
echo "PASSED"
