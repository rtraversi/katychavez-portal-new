// Stand-in for functions/api/_helpers.js inside the local preview. NOT PRODUCTION.
//
// Everything is the real module except the two things that would reach a live
// service: who is signed in (always a preview staff member) and the database
// (an in-memory fake). The preview server swaps this in for the real file with
// a module hook; nothing in the portal imports it.

export * from '../../../functions/api/_helpers.js';

export async function verifyAuth() {
  return { profile: { id: '00000000-0000-4000-8000-0000000000aa', roles: { name: 'Paralegal' } }, isClient: false };
}

export function makeAdminClient() {
  return globalThis.__PS2_PREVIEW_DB__;
}
