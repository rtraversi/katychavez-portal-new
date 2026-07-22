// Unit tests for the shared Zod schemas + validate() helper.
import { describe, it, expect } from 'vitest';
import {
  validate,
  UpdatePasswordSchema,
  MfaRecoverSchema,
  ClientSendMessageSchema,
  SendMessageSchema,
  DemoEventSchema,
  BookingBookSchema,
} from '../../functions/api/_schemas.js';

describe('validate()', () => {
  it('returns parsed data on success', () => {
    const v = validate(MfaRecoverSchema, { code: '  ABC123  ' });
    expect(v.error).toBeUndefined();
    expect(v.data.code).toBe('ABC123'); // trimmed
  });

  it('returns a 400 Response with a field-prefixed message on failure', async () => {
    const v = validate(UpdatePasswordSchema, { password: 'short' });
    expect(v.data).toBeUndefined();
    expect(v.error).toBeInstanceOf(Response);
    expect(v.error.status).toBe(400);
    const body = await v.error.json();
    expect(body.error).toMatch(/^password: /);
    expect(body.error).toContain('at least 8 characters');
  });

  it('rejects a missing required field with the field name in the message', async () => {
    const v = validate(SendMessageSchema, { body: 'hello' });
    expect(v.error.status).toBe(400);
    const body = await v.error.json();
    expect(body.error).toMatch(/^client_id: /);
  });
});

describe('UpdatePasswordSchema', () => {
  it('accepts an 8-char password (floor)', () => {
    expect(validate(UpdatePasswordSchema, { password: '12345678' }).data).toBeDefined();
  });
  it('accepts a 72-char password (bcrypt ceiling)', () => {
    expect(validate(UpdatePasswordSchema, { password: 'x'.repeat(72) }).data).toBeDefined();
  });
  it('rejects a 73-char password', () => {
    expect(validate(UpdatePasswordSchema, { password: 'x'.repeat(73) }).error).toBeDefined();
  });
  it('rejects a 7-char password', () => {
    expect(validate(UpdatePasswordSchema, { password: '1234567' }).error).toBeDefined();
  });
});

describe('ClientSendMessageSchema', () => {
  it('rejects an empty body', () => {
    expect(validate(ClientSendMessageSchema, { body: '   ' }).error).toBeDefined();
  });
  it('rejects a body over 5000 chars', () => {
    expect(validate(ClientSendMessageSchema, { body: 'x'.repeat(5001) }).error).toBeDefined();
  });
  it('accepts a normal message', () => {
    expect(validate(ClientSendMessageSchema, { body: 'Hello, counsel.' }).data).toBeDefined();
  });
});

describe('DemoEventSchema', () => {
  it('accepts the minimal required fields with optional fields absent', () => {
    const v = validate(DemoEventSchema, { session_id: 's1', event_type: 'page_view' });
    expect(v.data).toBeDefined();
  });
  it('accepts explicit nulls for optional fields', () => {
    const v = validate(DemoEventSchema, {
      session_id: 's1', event_type: 'click', role: null, module: null, action: null, ip_hash: null,
    });
    expect(v.data).toBeDefined();
  });
  it('rejects a missing session_id', () => {
    expect(validate(DemoEventSchema, { event_type: 'click' }).error).toBeDefined();
  });
  it('rejects an over-long event_type', () => {
    expect(validate(DemoEventSchema, { session_id: 's1', event_type: 'x'.repeat(51) }).error).toBeDefined();
  });
});

describe('BookingBookSchema', () => {
  const valid = {
    attorney: 'anita',
    consult_type_id: '4f6c1a1e-9c1b-4c56-9f21-0d6a1b2c3d4e',
    start: '2026-07-20T14:00:00.000Z',
    prospect_name: 'Pat Prospect',
    prospect_email: 'pat@example.com',
  };
  it('accepts a minimal valid booking', () => {
    expect(validate(BookingBookSchema, valid).data).toBeDefined();
  });
  it('accepts optional phone / case type / notes / turnstile', () => {
    const v = validate(BookingBookSchema, {
      ...valid,
      prospect_phone: '555-0100',
      case_type_id: '4f6c1a1e-9c1b-4c56-9f21-0d6a1b2c3d4f',
      notes: 'Referred by a friend.',
      turnstile_token: 'tok',
    });
    expect(v.data).toBeDefined();
  });
  it('rejects a malformed email', () => {
    expect(validate(BookingBookSchema, { ...valid, prospect_email: 'not-an-email' }).error).toBeDefined();
  });
  it('rejects a non-uuid consult_type_id', () => {
    expect(validate(BookingBookSchema, { ...valid, consult_type_id: 'abc' }).error).toBeDefined();
  });
  it('rejects a non-uuid case_type_id when provided', () => {
    expect(validate(BookingBookSchema, { ...valid, case_type_id: 'abc' }).error).toBeDefined();
  });
  it('rejects a missing prospect_name', () => {
    const { prospect_name, ...rest } = valid;
    expect(validate(BookingBookSchema, rest).error).toBeDefined();
  });
  it('rejects notes over 2000 chars', () => {
    expect(validate(BookingBookSchema, { ...valid, notes: 'x'.repeat(2001) }).error).toBeDefined();
  });
});
