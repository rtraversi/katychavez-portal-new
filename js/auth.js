// Authentication helpers.
// Requires: supabase-client.js loaded first (window.db available).
'use strict';

// Roles that must have TOTP enrolled before accessing the portal.
const MFA_REQUIRED_ROLES = new Set(['Owner', 'Attorney', 'Partner Attorney']);

window.Auth = (function () {

  // ── Session ─────────────────────────────────────────────────────────────────

  async function getSession() {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  // Returns true if this browser has a valid 30-day device-remembered token for the given email.
  function isDeviceRemembered(email) {
    try {
      const raw = localStorage.getItem('mfa_device_' + btoa(email));
      if (!raw) return false;
      const { expiry } = JSON.parse(raw);
      return typeof expiry === 'number' && expiry > Date.now();
    } catch (_) { return false; }
  }

  // Guard: call at the top of every portal page.
  // Redirects to / if no valid session, or to /account if MFA enrollment is required.
  async function requireAuth() {
    const session = await getSession();
    if (!session) {
      window.location.replace('/');
      return null;
    }

    // MFA enforcement gate
    try {
      const { data: aal } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal) {
        if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
          // Has an enrolled factor but hasn't verified it in this session.
          // Allow through if this device was remembered within the last 30 days.
          if (isDeviceRemembered(session.user.email)) {
            // Trusted device — skip re-verification
          } else {
            await db.auth.signOut();
            window.location.replace('/');
            return null;
          }
        }
        if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal1') {
          // No TOTP factor enrolled — check if role requires it.
          const profile = await getProfile();
          if (profile && MFA_REQUIRED_ROLES.has(profile.role?.name)) {
            window.location.replace('/account?enroll=1');
            return null;
          }
        }
      }
    } catch (e) {
      console.warn('[auth] MFA level check failed', e);
    }

    return session;
  }

  // ── MFA ─────────────────────────────────────────────────────────────────────

  async function getMFALevel() {
    const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  }

  // Returns only verified TOTP factors (used for enrolled-state checks).
  async function listMFAFactors() {
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) throw error;
    return data?.totp || [];
  }

  // Returns all TOTP factors including unverified pending ones (used for cleanup before re-enrollment).
  async function listAllMFAFactors() {
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) throw error;
    return (data?.all || []).filter(f => f.factor_type === 'totp');
  }

  async function enrollTOTP() {
    const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp' });
    if (error) throw error;
    return data; // { id, type, totp: { qr_code, secret, uri } }
  }

  async function challengeTOTP(factorId) {
    const { data, error } = await db.auth.mfa.challenge({ factorId });
    if (error) throw error;
    return data; // { id (challengeId) }
  }

  async function verifyTOTP(factorId, challengeId, code) {
    const { data, error } = await db.auth.mfa.verify({ factorId, challengeId, code });
    if (error) throw error;
    return data;
  }

  async function unenrollTOTP(factorId) {
    const { data, error } = await db.auth.mfa.unenroll({ factorId });
    if (error) throw error;
    return data;
  }

  // ── Current user profile ─────────────────────────────────────────────────────

  let _profileCache = null;

  async function getProfile(force = false) {
    if (_profileCache && !force) return _profileCache;

    const session = await getSession();
    if (!session) return null;

    const { data, error } = await db
      .from('users')
      .select(`
        id, first_name, last_name, email, active,
        role:roles (
          id, name, is_system_role,
          access:role_module_access ( module_key, access_level )
        )
      `)
      .eq('auth_id', session.user.id)
      .single();

    if (error) {
      console.error('[auth] Failed to load profile', error);
      return null;
    }

    _profileCache = data;
    return data;
  }

  // Returns a Set of module keys the current user can at least READ.
  async function getAccessibleModules(minLevel = 'read') {
    const profile = await getProfile();
    if (!profile) return new Set();

    const levels = { none: 0, read: 1, write: 2, admin: 3 };
    const min = levels[minLevel] ?? 1;

    return new Set(
      (profile.role?.access || [])
        .filter(a => (levels[a.access_level] ?? 0) >= min)
        .map(a => a.module_key)
    );
  }

  function clearCache() { _profileCache = null; }

  // ── Login / Logout ──────────────────────────────────────────────────────────

  async function login(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    clearCache();
    return data;
  }

  async function logout() {
    clearCache();
    await db.auth.signOut();
    window.location.replace('/');
  }

  async function sendPasswordReset(email) {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }

  // ── Auth state listener ─────────────────────────────────────────────────────

  function onAuthStateChange(callback) {
    return db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') clearCache();
      callback(event, session);
    });
  }

  return {
    getSession,
    requireAuth,
    isDeviceRemembered,
    getMFALevel,
    listMFAFactors,
    listAllMFAFactors,
    enrollTOTP,
    challengeTOTP,
    verifyTOTP,
    unenrollTOTP,
    getProfile,
    getAccessibleModules,
    clearCache,
    login,
    logout,
    sendPasswordReset,
    onAuthStateChange,
    MFA_REQUIRED_ROLES,
  };
})();
