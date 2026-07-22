// Shared helpers for all CF Pages Functions. NOT a route endpoint (underscore prefix).

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── Supabase admin client ──────────────────────────────────────────────────

export function makeAdminClient(env) {
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Auth + permission check ────────────────────────────────────────────────
// Returns { admin, user, profile, accessLevel, isClient } or { httpError: { status, message } }.
// minLevel: 'read' | 'write' | 'admin'
// opts.clientBypass: if true, Client-role users skip the module access check
//   (caller is responsible for verifying they only touch their own matter).

const ACCESS_ORDER = ['none', 'read', 'write', 'admin'];

export async function verifyAuth(request, env, minLevel = 'read', moduleKey = 'uploads', opts = {}) {
  const token = (request.headers.get('authorization') || request.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return { httpError: { status: 401, message: 'Unauthorized' } };

  const admin = makeAdminClient(env);

  let authData, authErr;
  try {
    ({ data: authData, error: authErr } = await admin.auth.getUser(token));
  } catch (err) {
    console.error('[verifyAuth] getUser network error:', err.message);
    return { httpError: { status: 503, message: 'Authentication service temporarily unavailable. Please try again.' } };
  }

  const user = authData?.user;
  if (authErr || !user) return { httpError: { status: 401, message: 'Invalid token' } };

  let profile;
  try {
    const { data } = await admin
      .from('users')
      .select('id, role_id, first_name, last_name, active, roles(name)')
      .eq('auth_id', user.id)
      .single();
    profile = data;
  } catch (err) {
    console.error('[verifyAuth] users query error:', err.message);
    return { httpError: { status: 503, message: 'Service temporarily unavailable. Please try again.' } };
  }

  if (!profile || !profile.active) {
    return { httpError: { status: 403, message: 'User not found or inactive' } };
  }

  const roleName = profile.roles?.name;
  const isClient = roleName === 'Client';

  if (opts.clientBypass && isClient) {
    return { admin, user, profile, accessLevel: 'write', isClient: true };
  }

  let access;
  try {
    const { data } = await admin
      .from('role_module_access')
      .select('access_level')
      .eq('role_id', profile.role_id)
      .eq('module_key', moduleKey)
      .single();
    access = data;
  } catch (err) {
    console.error('[verifyAuth] role_module_access query error:', err.message);
    return { httpError: { status: 503, message: 'Service temporarily unavailable. Please try again.' } };
  }

  const userLevel = access?.access_level || 'none';
  if (ACCESS_ORDER.indexOf(userLevel) < ACCESS_ORDER.indexOf(minLevel)) {
    return { httpError: { status: 403, message: `Insufficient permissions for ${moduleKey} module` } };
  }

  return { admin, user, profile, accessLevel: userLevel, isClient: false };
}

// ── R2 client ─────────────────────────────────────────────────────────────

export function makeR2Client(env) {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // Disable auto-checksum: AWS SDK v3 injects x-amz-checksum-crc32=AAAAAA== into
    // presigned URLs, causing R2 to 403 before it can serve CORS headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

// ── Presigned PUT URL (upload) ─────────────────────────────────────────────

export async function presignedPut(env, r2Key, contentType, ttlSeconds = 900) {
  const r2 = makeR2Client(env);
  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: r2Key,
    ContentType: contentType,
    ChecksumAlgorithm: undefined,
  });
  return getSignedUrl(r2, cmd, { expiresIn: ttlSeconds });
}

// ── Presigned GET URL (download) ──────────────────────────────────────────

export async function presignedGet(env, r2Key, ttlSeconds = 3600) {
  const r2 = makeR2Client(env);
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: r2Key,
  });
  return getSignedUrl(r2, cmd, { expiresIn: ttlSeconds });
}

// ── Delete R2 object ──────────────────────────────────────────────────────

export async function deleteR2Object(env, r2Key) {
  if (env.R2) {
    await env.R2.delete(r2Key);
    return;
  }
  const r2 = makeR2Client(env);
  const cmd = new DeleteObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: r2Key,
  });
  return r2.send(cmd);
}

// ── Sanitize filename ─────────────────────────────────────────────────────

export function sanitizeFilename(name) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200);
}

// ── SSN encryption (AES-256-GCM) ─────────────────────────────────────────
// Key is a 64-char hex string stored in SSN_ENCRYPTION_KEY env var (32 bytes).
// Stored format: hex(iv):hex(authTag):hex(ciphertext)

export function ssnEncrypt(plaintext, env) {
  const keyHex = env.SSN_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) throw new Error('SSN_ENCRYPTION_KEY not configured (must be 64-char hex)');
  const key    = Buffer.from(keyHex, 'hex');
  const iv     = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function ssnDecrypt(stored, env) {
  const keyHex = env.SSN_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) throw new Error('SSN_ENCRYPTION_KEY not configured');
  const parts = stored.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted SSN format');
  const [ivHex, tagHex, encHex] = parts;
  const key      = Buffer.from(keyHex, 'hex');
  const iv       = Buffer.from(ivHex,  'hex');
  const tag      = Buffer.from(tagHex, 'hex');
  const enc      = Buffer.from(encHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ── Upload capability token (HMAC) ─────────────────────────────────────────
// Turns the upload-proxy URL into a short-lived signed capability instead of
// relying on the raw document UUID (which is not secret). Minted by
// get-upload-url and verified by upload-proxy. Format: base64url(payload).base64url(sig)
// where payload = { d: docId, e: expiryMs }. No new per-client secret required —
// the key is derived from an existing secret and both endpoints resolve it identically.

function uploadTokenKeyMaterial(env) {
  return env.UPLOAD_TOKEN_SECRET || env.WEBDAV_TOKEN_SECRET || env.SUPABASE_SERVICE_KEY || '';
}

const b64url = {
  enc: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
  dec: (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
};

async function uploadTokenKey(env, usage) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(uploadTokenKeyMaterial(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

export async function signUploadToken(docId, env, ttlSeconds = 900) {
  const payloadB64 = b64url.enc(new TextEncoder().encode(JSON.stringify({ d: docId, e: Date.now() + ttlSeconds * 1000 })));
  const key = await uploadTokenKey(env, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64url.enc(new Uint8Array(sig))}`;
}

export async function verifyUploadToken(token, docId, env) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await uploadTokenKey(env, 'verify');
    const ok = await crypto.subtle.verify('HMAC', key, b64url.dec(sigB64), new TextEncoder().encode(payloadB64));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64url.dec(payloadB64)));
    if (payload.d !== docId) return false;
    if (typeof payload.e !== 'number' || payload.e < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Turnstile verification (public endpoints) ─────────────────────────────
// Gracefully no-ops when TURNSTILE_SECRET_KEY is not configured (dev /
// pre-domain setup) — same pattern as the Resend key. Fails CLOSED when a
// secret IS set but verification errors or the token is bad.

export async function verifyTurnstile(env, token, ip, logTag = 'turnstile') {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.log(`[${logTag}] TURNSTILE_SECRET_KEY not set — skipping captcha check`);
    return true;
  }
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.append('secret', secret);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const data = await res.json();
    return !!data.success;
  } catch (err) {
    console.error(`[${logTag}] turnstile verify error:`, err.message);
    return false;
  }
}

// ── Standard response helper ──────────────────────────────────────────────

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
