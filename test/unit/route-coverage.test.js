// Route coverage: every /api/... path the front end calls must be registered in
// the _worker.js routes table.
//
// Why this exists: the FB-first invoice flow shipped with fb-unpaid-invoices and
// mirror-fb-invoice implemented, tested, and NOT registered. Dispatch is exact
// match (`routes[url.pathname]`), so both silently fell through to static assets
// and returned 404 — while the suite stayed green at 287/287, because every unit
// test imports its handler function directly and never exercises registration.
//
// Tests run inside workerd with no filesystem, so the page sources are pulled in
// as raw strings at build time via import.meta.glob.
import { describe, it, expect } from 'vitest';
import { routes } from '../../_worker.js';

// Raw source of everything that could call an API endpoint.
const pageSources = import.meta.glob('../../{pages,js}/**/*.js', {
  query: '?raw', import: 'default', eager: true,
});

// Paths served by something other than the exact-match table (prefix handlers
// dispatched earlier in the worker, or endpoints that legitimately 404 for the
// browser). Keep this list short and justified — every entry is a hole in the check.
const NOT_IN_ROUTES_TABLE = [
  '/api/freshbooks/',   // OAuth sub-paths, matched by prefix before the table
];

function isExempt(path) {
  return NOT_IN_ROUTES_TABLE.some(prefix => path.startsWith(prefix));
}

// Collect '/api/foo' occurrences, dropping query strings and template
// interpolation ('/api/get-unbilled-time?matter_id=${id}' -> '/api/get-unbilled-time').
function apiPathsIn(source) {
  const found = new Set();
  for (const [, path] of source.matchAll(/['"`](\/api\/[a-zA-Z0-9/_-]+)/g)) {
    found.add(path);
  }
  return found;
}

describe('_worker.js route coverage', () => {
  const called = new Map();   // path -> [files that call it]

  for (const [file, source] of Object.entries(pageSources)) {
    for (const path of apiPathsIn(source)) {
      if (!called.has(path)) called.set(path, []);
      called.get(path).push(file.replace('../../', ''));
    }
  }

  it('finds API calls to check (guards against the glob silently matching nothing)', () => {
    expect(Object.keys(pageSources).length).toBeGreaterThan(0);
    expect(called.size).toBeGreaterThan(10);
  });

  it('registers every /api path the front end calls', () => {
    const missing = [...called.entries()]
      .filter(([path]) => !isExempt(path) && !(path in routes))
      .map(([path, files]) => `${path}  ← ${files.join(', ')}`);

    expect(missing, `Unregistered API paths (these 404 at runtime):\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('exposes a non-empty routes table', () => {
    expect(Object.keys(routes).length).toBeGreaterThan(0);
    for (const [path, handler] of Object.entries(routes)) {
      expect(typeof handler, `route ${path} is not a function`).toBe('function');
    }
  });
});
