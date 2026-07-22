// Unit tests for the WebDAV token crypto in functions/api/webdav.js.
// Runs in workerd via @cloudflare/vitest-pool-workers — real crypto.subtle,
// dummy env from test/wrangler.toml, no live services.
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { generateWebDAVToken, verifyWebDAVToken } from '../../functions/api/webdav.js';

const b64url = (s) => btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

// Sign an arbitrary payload with the same HMAC scheme as generateWebDAVToken,
// so expiry and shape edge cases can be crafted directly.
async function signPayload(payload, secret) {
  const payloadB64 = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${payloadB64}.${sigB64}`;
}

describe('WebDAV token round-trip', () => {
  it('generate → verify returns userId/docId, kind defaults to draft', async () => {
    const token = await generateWebDAVToken('user-1', 'doc-1', env);
    const payload = await verifyWebDAVToken(token, env);
    expect(payload).toMatchObject({ userId: 'user-1', docId: 'doc-1', kind: 'draft' });
    expect(payload.exp).toBeGreaterThan(Date.now());
  });

  it('carries kind=doc for office_edit tokens', async () => {
    const token = await generateWebDAVToken('user-1', 'doc-2', env, 'doc');
    const payload = await verifyWebDAVToken(token, env);
    expect(payload.kind).toBe('doc');
  });

  it('rejects an expired token', async () => {
    const token = await signPayload(
      { userId: 'u', docId: 'd', kind: 'draft', exp: Date.now() - 1000 },
      env.WEBDAV_TOKEN_SECRET
    );
    expect(await verifyWebDAVToken(token, env)).toBeNull();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await signPayload(
      { userId: 'u', docId: 'd', kind: 'draft', exp: Date.now() + 60000 },
      'some-other-secret'
    );
    expect(await verifyWebDAVToken(token, env)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await generateWebDAVToken('user-1', 'doc-1', env);
    const [, sig] = token.split('.');
    const forged = b64url(JSON.stringify({ userId: 'attacker', docId: 'doc-1', kind: 'doc', exp: Date.now() + 60000 }));
    expect(await verifyWebDAVToken(`${forged}.${sig}`, env)).toBeNull();
  });

  it('rejects garbage and missing tokens', async () => {
    expect(await verifyWebDAVToken('not-a-token', env)).toBeNull();
    expect(await verifyWebDAVToken('', env)).toBeNull();
    expect(await verifyWebDAVToken(null, env)).toBeNull();
  });

  it('rejects any token when the secret is not configured', async () => {
    const token = await generateWebDAVToken('user-1', 'doc-1', env);
    expect(await verifyWebDAVToken(token, {})).toBeNull();
  });
});
