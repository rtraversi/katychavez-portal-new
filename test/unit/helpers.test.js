// Unit tests for the pure/crypto helpers in functions/api/_helpers.js.
// `env` comes from wrangler.test.toml — dummy values, no live services.
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import {
  sanitizeFilename,
  json,
  ssnEncrypt,
  ssnDecrypt,
  signUploadToken,
  verifyUploadToken,
} from '../../functions/api/_helpers.js';

describe('sanitizeFilename', () => {
  it('replaces unsafe characters with underscores and collapses runs', () => {
    expect(sanitizeFilename('my file (final)!.pdf')).toBe('my_file_final_.pdf');
  });
  it('trims and caps at 200 chars', () => {
    expect(sanitizeFilename('  ' + 'a'.repeat(300) + '.pdf')).toHaveLength(200);
  });
  it('keeps dots, dashes, underscores', () => {
    expect(sanitizeFilename('W-2_2025.final.pdf')).toBe('W-2_2025.final.pdf');
  });
});

describe('json()', () => {
  it('builds a JSON response with the given status', async () => {
    const r = json(418, { error: 'teapot' });
    expect(r.status).toBe(418);
    expect(r.headers.get('Content-Type')).toBe('application/json');
    expect(await r.json()).toEqual({ error: 'teapot' });
  });
});

describe('SSN encryption (AES-256-GCM)', () => {
  it('round-trips plaintext', () => {
    const stored = ssnEncrypt('123-45-6789', env);
    expect(ssnDecrypt(stored, env)).toBe('123-45-6789');
  });
  it('produces the iv:tag:ciphertext hex format', () => {
    const parts = ssnEncrypt('123-45-6789', env).split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{24}$/); // 12-byte IV
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte auth tag
  });
  it('never produces the same ciphertext twice (random IV)', () => {
    expect(ssnEncrypt('123-45-6789', env)).not.toBe(ssnEncrypt('123-45-6789', env));
  });
  it('throws on a tampered ciphertext (GCM auth)', () => {
    const stored = ssnEncrypt('123-45-6789', env);
    const [iv, tag, enc] = stored.split(':');
    const flipped = (parseInt(enc[0], 16) ^ 1).toString(16) + enc.slice(1);
    expect(() => ssnDecrypt(`${iv}:${tag}:${flipped}`, env)).toThrow();
  });
  it('throws when the key is missing or malformed', () => {
    expect(() => ssnEncrypt('123-45-6789', {})).toThrow(/SSN_ENCRYPTION_KEY/);
    expect(() => ssnEncrypt('123-45-6789', { SSN_ENCRYPTION_KEY: 'tooshort' })).toThrow(/SSN_ENCRYPTION_KEY/);
  });
});

describe('upload capability token (HMAC)', () => {
  it('round-trips for the matching docId', async () => {
    const token = await signUploadToken('doc-123', env);
    expect(await verifyUploadToken(token, 'doc-123', env)).toBe(true);
  });
  it('rejects a different docId', async () => {
    const token = await signUploadToken('doc-123', env);
    expect(await verifyUploadToken(token, 'doc-456', env)).toBe(false);
  });
  it('rejects an expired token', async () => {
    const token = await signUploadToken('doc-123', env, -1); // already expired
    expect(await verifyUploadToken(token, 'doc-123', env)).toBe(false);
  });
  it('rejects a tampered signature', async () => {
    const token = await signUploadToken('doc-123', env);
    const [payload] = token.split('.');
    expect(await verifyUploadToken(`${payload}.AAAA`, 'doc-123', env)).toBe(false);
  });
  it('rejects garbage input without throwing', async () => {
    expect(await verifyUploadToken('not-a-token', 'doc-123', env)).toBe(false);
    expect(await verifyUploadToken('', 'doc-123', env)).toBe(false);
    expect(await verifyUploadToken(null, 'doc-123', env)).toBe(false);
  });
  it('rejects a token signed under a different secret', async () => {
    const token = await signUploadToken('doc-123', { ...env, UPLOAD_TOKEN_SECRET: 'other-secret' });
    expect(await verifyUploadToken(token, 'doc-123', env)).toBe(false);
  });
});
