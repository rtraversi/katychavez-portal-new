// Authentication helpers.
// Requires: supabase-client.js loaded first (window.db available).
'use strict';

window.Auth = (function () {

  // ── Session ─────────────────────────────────────────────────────────────────

  async function getSession() {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  // Guard: call at the top of every portal page.
  // Redirects to / if no valid session.
  async function requireAuth() {
    const session = await getSession();
    if (!session) {
      window.location.replace('/');
      return null;
    }
    return session;
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
    getProfile,
    getAccessibleModules,
    clearCache,
    login,
    logout,
    sendPasswordReset,
    onAuthStateChange,
  };
})();
