// Integration tests through the WHOLE worker (SELF = _worker.js running in
// workerd with the bindings from wrangler.test.toml). Importing _worker.js
// also doubles as a build smoke test: a broken import in ANY of the ~80 route
// modules fails this suite before it could fail a deploy.
//
// No test here may reach a live service — every asserted path returns before
// the handler would talk to Supabase/R2/Resend.
import { describe, it, expect } from 'vitest';
import { SELF, env as envFromTest } from 'cloudflare:test';
import { routes, RATE_LIMITS, CSP } from '../../_worker.js';
import { generateWebDAVToken } from '../../functions/api/webdav.js';
import headersFile from '../../_headers?raw';

const BASE = 'https://example.com';

describe('route table consistency', () => {
  it('every route is an /api/ path with a function handler', () => {
    for (const [path, handler] of Object.entries(routes)) {
      expect(path, path).toMatch(/^\/api\//);
      expect(typeof handler, path).toBe('function');
    }
  });

  it('every rate-limited path exists in the route table (a typo here silently disables the limit)', () => {
    for (const path of Object.keys(RATE_LIMITS)) {
      expect(routes[path], `${path} is in RATE_LIMITS but not in routes`).toBeDefined();
    }
  });

  it('rate-limit tiers are one of the three declared bindings', () => {
    for (const [path, binding] of Object.entries(RATE_LIMITS)) {
      expect(['RL_STRICT', 'RL_STANDARD', 'RL_BEACON'], path).toContain(binding);
    }
  });
});

describe('CSP stays in sync between _worker.js and _headers', () => {
  it('the _headers Content-Security-Policy line matches the CSP const exactly', () => {
    const m = headersFile.match(/Content-Security-Policy:\s*(.+)/);
    expect(m, '_headers has no Content-Security-Policy line').toBeTruthy();
    expect(m[1].trim()).toBe(CSP);
  });
});

describe('auth gate (no request below reaches Supabase)', () => {
  it('update-password: GET → 405', async () => {
    const r = await SELF.fetch(`${BASE}/api/update-password`);
    expect(r.status).toBe(405);
  });

  it('update-password: POST without a token → 401', async () => {
    const r = await SELF.fetch(`${BASE}/api/update-password`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });

  it('update-password: invalid JSON → 400', async () => {
    const r = await SELF.fetch(`${BASE}/api/update-password`, {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-token' },
      body: 'not json',
    });
    expect(r.status).toBe(400);
  });

  it('update-password: short password → 400 with the Zod message', async () => {
    const r = await SELF.fetch(`${BASE}/api/update-password`, {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'short' }),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toContain('at least 8 characters');
  });

  it('a protected upload route without a token → 401', async () => {
    const r = await SELF.fetch(`${BASE}/api/get-download-url`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });
});

describe('webdav endpoint (no request below reaches Supabase)', () => {
  const DAV_METHODS = ['GET', 'HEAD', 'PUT', 'PROPFIND', 'PROPPATCH', 'LOCK', 'UNLOCK'];

  it('OPTIONS advertises the full method set Word\'s save sequence needs', async () => {
    const r = await SELF.fetch(`${BASE}/webdav/some-token/some-doc/file.docx`, { method: 'OPTIONS' });
    expect(r.status).toBe(200);
    expect(r.headers.get('DAV')).toBe('1,2');
    expect(r.headers.get('MS-Author-Via')).toBe('DAV');
    const allow = r.headers.get('Allow');
    // HEAD and PROPPATCH were missing pre-fix — their absence made Word
    // report "upload failed" after an otherwise-successful PUT.
    for (const m of ['OPTIONS', ...DAV_METHODS]) expect(allow, `Allow must include ${m}`).toContain(m);
  });

  it('every non-OPTIONS method is rejected with 401 on a bad token', async () => {
    for (const method of DAV_METHODS) {
      const r = await SELF.fetch(`${BASE}/webdav/bad-token/some-doc/file.docx`, { method });
      expect(r.status, method).toBe(401);
    }
  });

  it('a validly signed token still 401s when the docId does not match the URL', async () => {
    const token = await generateWebDAVToken('user-1', 'doc-A', envFromTest, 'doc');
    const r = await SELF.fetch(`${BASE}/webdav/${token}/doc-B/file.docx`, { method: 'PROPFIND' });
    expect(r.status).toBe(401);
  });

  it('missing token or docId → 404', async () => {
    const r = await SELF.fetch(`${BASE}/webdav/`, { method: 'PROPFIND' });
    expect(r.status).toBe(404);
  });
});

describe('office-edit open route', () => {
  it('is registered in the route table', () => {
    expect(routes['/api/office-edit/open']).toBeDefined();
  });

  it('GET → 405', async () => {
    const r = await SELF.fetch(`${BASE}/api/office-edit/open`);
    expect(r.status).toBe(405);
  });

  it('POST without a token → 401', async () => {
    const r = await SELF.fetch(`${BASE}/api/office-edit/open`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });
});

describe('freshbooks OAuth routes (no request below reaches Supabase)', () => {
  for (const path of [
    '/api/freshbooks/oauth-url',
    '/api/freshbooks/oauth-callback',
    '/api/freshbooks/status',
    '/api/freshbooks/disconnect',
  ]) {
    it(`${path} is registered in the route table`, () => {
      expect(routes[path]).toBeDefined();
    });
  }

  it('oauth-url: POST → 405 (method check precedes auth)', async () => {
    const r = await SELF.fetch(`${BASE}/api/freshbooks/oauth-url`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(405);
  });

  it('oauth-url: GET without a token → 401', async () => {
    const r = await SELF.fetch(`${BASE}/api/freshbooks/oauth-url`);
    expect(r.status).toBe(401);
  });

  it('status: GET without a token → 401', async () => {
    const r = await SELF.fetch(`${BASE}/api/freshbooks/status`);
    expect(r.status).toBe(401);
  });

  it('disconnect: GET → 405', async () => {
    const r = await SELF.fetch(`${BASE}/api/freshbooks/disconnect`);
    expect(r.status).toBe(405);
  });

  it('disconnect: POST without a token → 401', async () => {
    const r = await SELF.fetch(`${BASE}/api/freshbooks/disconnect`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });

  // The callback has no auth header (FreshBooks redirects to it); with no code/state
  // it must redirect back to billing settings with an error BEFORE touching Supabase.
  it('oauth-callback: missing code/state → 302 redirect to billing settings with an error', async () => {
    const r = await SELF.fetch(`${BASE}/api/freshbooks/oauth-callback`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const loc = r.headers.get('Location');
    expect(loc).toContain('fb_result=error');
    expect(loc).toContain('#settings/billing');
  });
});

describe('file manager + manual storage push routes', () => {
  for (const path of ['/api/matter-folders', '/api/storage-push-document']) {
    it(`${path} is registered in the route table`, () => {
      expect(routes[path]).toBeDefined();
    });

    it(`${path}: GET → 405`, async () => {
      const r = await SELF.fetch(`${BASE}${path}`);
      expect(r.status).toBe(405);
    });

    it(`${path}: POST without a token → 401`, async () => {
      const r = await SELF.fetch(`${BASE}${path}`, { method: 'POST', body: '{}' });
      expect(r.status).toBe(401);
    });
  }
});

describe('send intake + public intake routes (no request below reaches Supabase)', () => {
  for (const path of ['/api/send-intake', '/api/intake-public-load', '/api/intake-public-submit']) {
    it(`${path} is registered in the route table`, () => {
      expect(routes[path]).toBeDefined();
    });
  }

  it('send-intake: GET → 405', async () => {
    const r = await SELF.fetch(`${BASE}/api/send-intake`);
    expect(r.status).toBe(405);
  });

  it('send-intake: POST without a token → 401 (staff-only)', async () => {
    const r = await SELF.fetch(`${BASE}/api/send-intake`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(401);
  });

  it('intake-public-load: POST → 405', async () => {
    const r = await SELF.fetch(`${BASE}/api/intake-public-load`, { method: 'POST', body: '{}' });
    expect(r.status).toBe(405);
  });

  it('intake-public-load: GET without ?token → 400', async () => {
    const r = await SELF.fetch(`${BASE}/api/intake-public-load`);
    expect(r.status).toBe(400);
  });

  it('intake-public-submit: GET → 405', async () => {
    const r = await SELF.fetch(`${BASE}/api/intake-public-submit`);
    expect(r.status).toBe(405);
  });

  it('intake-public-submit: invalid JSON → 400', async () => {
    const r = await SELF.fetch(`${BASE}/api/intake-public-submit`, { method: 'POST', body: 'not json' });
    expect(r.status).toBe(400);
  });

  it('intake-public-submit: missing token → 400 (returns before any DB call)', async () => {
    const r = await SELF.fetch(`${BASE}/api/intake-public-submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opposing_party: { first_name: 'X' } }),
    });
    expect(r.status).toBe(400);
  });
});

describe('demo-event beacon', () => {
  it('no-ops with 200 when DEMO_MODE is not enabled', async () => {
    const r = await SELF.fetch(`${BASE}/api/demo-event`, {
      method: 'POST',
      body: JSON.stringify({ session_id: 's1', event_type: 'page_view' }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('rejects non-POST methods', async () => {
    const r = await SELF.fetch(`${BASE}/api/demo-event`);
    expect(r.status).toBe(405);
  });
});

describe('static assets + security headers', () => {
  it('serves HTML with the full security header set', async () => {
    const r = await SELF.fetch(`${BASE}/index.html`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('TEST-FIXTURE-INDEX');
    expect(r.headers.get('Content-Security-Policy')).toBe(CSP);
    expect(r.headers.get('X-Frame-Options')).toBe('DENY');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(r.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(r.headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('rewrites the clean /portal URL to portal.html', async () => {
    const r = await SELF.fetch(`${BASE}/portal`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('TEST-FIXTURE-PORTAL');
  });

  it('rewrites /portal/anything to portal.html (SPA deep links)', async () => {
    const r = await SELF.fetch(`${BASE}/portal/matters/123`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('TEST-FIXTURE-PORTAL');
  });

  it('unknown paths fall through to the asset layer (404)', async () => {
    const r = await SELF.fetch(`${BASE}/definitely-not-a-real-page`);
    expect(r.status).toBe(404);
  });
});
