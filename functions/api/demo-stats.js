// demo-stats.js — returns visitor analytics summary for the RMT portal tile.
// GET  Authorization: Bearer <DEMO_STATS_TOKEN>
// Only active when DEMO_MODE=true. Returns 404 in production.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'GET')    return json(405, { error: 'Method not allowed' });
  if (env.DEMO_MODE !== 'true')   return json(404, { error: 'Not found' });

  // Bearer token auth — checked against DEMO_STATS_TOKEN secret
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== env.DEMO_STATS_TOKEN) {
    return json(401, { error: 'Unauthorized' });
  }

  try {
    const admin = makeAdminClient(env);
    const since7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sinceToday = new Date(new Date().toDateString()).toISOString();

    const [visitorsTodayRes, loginRes, sessionRes, moduleRes] = await Promise.all([
      // Unique sessions today (proxy for unique visitors)
      admin.from('demo_events')
        .select('session_id', { count: 'exact', head: false })
        .eq('event_type', 'page_load')
        .gte('created_at', sinceToday),

      // Logins in last 7 days
      admin.from('demo_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'login')
        .gte('created_at', since7d),

      // Total unique sessions (7 days)
      admin.from('demo_events')
        .select('session_id')
        .gte('created_at', since7d),

      // Module views (7 days) — for top module
      admin.from('demo_events')
        .select('module')
        .eq('event_type', 'module_view')
        .gte('created_at', since7d)
        .not('module', 'is', null),
    ]);

    // Unique visitors today (distinct session_ids)
    const todaySessions = new Set((visitorsTodayRes.data || []).map(r => r.session_id));
    const visitorsToday = todaySessions.size;

    // Total unique sessions (7 days)
    const allSessions = new Set((sessionRes.data || []).map(r => r.session_id));
    const sessions7d  = allSessions.size;

    // Top module by view count
    const moduleCounts = {};
    for (const row of (moduleRes.data || [])) {
      if (row.module) moduleCounts[row.module] = (moduleCounts[row.module] || 0) + 1;
    }
    const topModule = Object.entries(moduleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Avg session duration (last event - first event per session_id, 7 days)
    let avgSessionMinutes = null;
    if (sessions7d > 0) {
      const { data: durationRows } = await admin
        .from('demo_events')
        .select('session_id, created_at')
        .gte('created_at', since7d)
        .order('created_at', { ascending: true });

      if (durationRows?.length) {
        const bySession = {};
        for (const row of durationRows) {
          if (!bySession[row.session_id]) bySession[row.session_id] = { first: row.created_at, last: row.created_at };
          bySession[row.session_id].last = row.created_at;
        }
        const durations = Object.values(bySession)
          .map(s => (new Date(s.last) - new Date(s.first)) / 60000)
          .filter(d => d > 0.1); // exclude single-event sessions
        if (durations.length > 0) {
          avgSessionMinutes = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
        }
      }
    }

    return json(200, {
      visitors_today:       visitorsToday,
      logins_7d:            loginRes.count || 0,
      sessions_7d:          sessions7d,
      top_module:           topModule,
      avg_session_minutes:  avgSessionMinutes,
    });

  } catch (err) {
    console.error('[demo-stats] error:', err.message);
    return json(500, { error: err.message });
  }
}
