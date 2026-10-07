#!/usr/bin/env bash
# TEST ONLY. Checks what the Proof Scan v2 migrations promise, against a
# throwaway LOCAL Postgres database. Never point this at Supabase.
#
#   scripts/proof-scan-v2-dbcheck/run.sh                     normal run
#   scripts/proof-scan-v2-dbcheck/run.sh mutations/cases.sql  apply a mutation that
#                                                             removes a rule, to prove
#                                                             the checks catch it
#
# Creates a fresh database, applies shim.sql and the migration chain, optionally a
# mutation, runs checks.sql, prints PASS/FAIL per check, then drops the database.
# Exits 1 if any check fails. Needs a local Postgres (Homebrew postgresql@16).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
DB="${PROOF_SCAN_DBCHECK_DB:-proof_scan_v2_test}"

if ! command -v psql >/dev/null 2>&1 && [ -d /opt/homebrew/opt/postgresql@16/bin ]; then
  export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
fi

# Local socket only: refuse to run if the environment points psql anywhere else.
unset PGHOST PGHOSTADDR PGSERVICE PGPASSWORD DATABASE_URL
export PGHOST=/tmp
export PGOPTIONS="-c client_min_messages=warning"

# The minimal chain the Proof Scan migrations depend on, in filename order.
#   001-003  core tables, roles, can_read/can_write helpers
#   005      the Client and Partner Attorney roles
# Left out on purpose: 1301_sig_stamp_module.sql (Signature Stamp, unrelated to
# Proof Scan). It needs 1050_enabled_modules, which in turn seeds modules from
# 500 / 600 / 800 / 1000-series migrations; none of that touches Proof Scan.
CHAIN=(
  001_core_tables.sql
  002_rbac.sql
  003_rls_policies.sql
  005_client_portal.sql
  1300_proof_scan.sql
  1301_proof_scan_notify_email.sql
  1302_proof_scan_structured_results.sql
  1303_proof_scan_history_metadata.sql
  2000_proof_scan_security.sql
  2001_proof_scan_v2_core.sql
  2002_proof_scan_v2_rules.sql
  2003_proof_scan_v2_seed.sql
)

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

dropdb --if-exists "$DB" >/dev/null 2>&1
createdb "$DB"

"${PSQL[@]}" -f "$HERE/shim.sql" >/dev/null
for f in "${CHAIN[@]}"; do
  if ! out=$("${PSQL[@]}" -f "$MIGRATIONS/$f" 2>&1); then
    echo "MIGRATION FAILED: $f"; echo "$out"; exit 1
  fi
done

if [ "${1:-}" != "" ]; then
  echo "Applying mutation: $1"
  "${PSQL[@]}" -f "$HERE/$1" >/dev/null
fi

"${PSQL[@]}" -f "$HERE/checks.sql" >/dev/null

"${PSQL[@]}" -At -F ' ' -c "
  SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, name || coalesce('  [' || CASE WHEN ok THEN NULL ELSE detail END || ']', '')
  FROM dbcheck.results ORDER BY n"

failed=$("${PSQL[@]}" -At -c "SELECT count(*) FROM dbcheck.results WHERE NOT ok")
total=$("${PSQL[@]}" -At -c "SELECT count(*) FROM dbcheck.results")
echo "$((total - failed))/$total passed"
[ "$failed" = "0" ]
