import { onRequest as confirmUpload } from './functions/api/confirm-upload.js';
import { onRequest as createSignatureRequest } from './functions/api/create-signature-request.js';
import { onRequest as declineSignature } from './functions/api/decline-signature.js';
import { onRequest as deleteDocument } from './functions/api/delete-document.js';
import { onRequest as getDownloadUrl } from './functions/api/get-download-url.js';
import { onRequest as getSignatureRequest } from './functions/api/get-signature-request.js';
import { onRequest as getUploadUrl } from './functions/api/get-upload-url.js';
import { onRequest as inviteClient } from './functions/api/invite-client.js';
import { onRequest as inviteUser } from './functions/api/invite-user.js';
import { onRequest as r2ToB2Sync } from './functions/api/r2-to-b2-sync.js';
import { onRequest as resendClientAccess } from './functions/api/resend-client-access.js';
import { onRequest as revealSsn } from './functions/api/reveal-ssn.js';
import { onRequest as saveSsn } from './functions/api/save-ssn.js';
import { onRequest as signDocument }         from './functions/api/sign-document.js';
import { onRequest as updateClientProfile }  from './functions/api/update-client-profile.js';
import { onRequest as runConflictCheck }     from './functions/api/run-conflict-check.js';
import { onRequest as sendMessage }          from './functions/api/send-message.js';
import { onRequest as clientSendMessage }    from './functions/api/client-send-message.js';
import { onRequest as getConversations }     from './functions/api/get-conversations.js';
import { onRequest as getMessages }          from './functions/api/get-messages.js';
import { onRequest as sendDocReminder }      from './functions/api/send-doc-reminder.js';
import { onRequest as processDocReminders }  from './functions/api/process-doc-reminders.js';
import { run as runDocReminders }            from './functions/api/process-doc-reminders.js';
import { onRequest as getDocTemplates }      from './functions/api/get-doc-templates.js';
import { onRequest as saveDocTemplate }      from './functions/api/save-doc-template.js';
import { onRequest as analyzeDocument }      from './functions/api/analyze-document.js';
import { onRequest as calendarOauthUrl }         from './functions/api/calendar-oauth-url.js';
import { onRequest as calendarOauthCallback }    from './functions/api/calendar-oauth-callback.js';
import { onRequest as calendarStatus }           from './functions/api/calendar-status.js';
import { onRequest as calendarDisconnect }       from './functions/api/calendar-disconnect.js';
import { onRequest as calendarEvents }           from './functions/api/calendar-events.js';
import { onRequest as calendarOutlookOauthUrl }      from './functions/api/calendar-outlook-oauth-url.js';
import { onRequest as calendarOutlookOauthCallback } from './functions/api/calendar-outlook-oauth-callback.js';
import { onRequest as resetUserPassword }            from './functions/api/reset-user-password.js';
import { onRequest as deleteUser }                   from './functions/api/delete-user.js';
import { onRequest as processMessageNotifications, run as runMessageNotifications } from './functions/api/process-message-notifications.js';
import { onRequest as draftingGenerate }            from './functions/api/drafting-generate.js';
import { onRequest as draftingToggleFinal }         from './functions/api/drafting-toggle-final.js';
import { onRequest as calendarIcalFeed }            from './functions/api/calendar-ical-feed.js';
import { onRequest as calendarIcalToken }           from './functions/api/calendar-ical-token.js';

const routes = {
  '/api/confirm-upload': confirmUpload,
  '/api/create-signature-request': createSignatureRequest,
  '/api/decline-signature': declineSignature,
  '/api/delete-document': deleteDocument,
  '/api/get-download-url': getDownloadUrl,
  '/api/get-signature-request': getSignatureRequest,
  '/api/get-upload-url': getUploadUrl,
  '/api/invite-client': inviteClient,
  '/api/invite-user': inviteUser,
  '/api/r2-to-b2-sync': r2ToB2Sync,
  '/api/resend-client-access': resendClientAccess,
  '/api/reveal-ssn': revealSsn,
  '/api/save-ssn': saveSsn,
  '/api/sign-document': signDocument,
  '/api/update-client-profile': updateClientProfile,
  '/api/run-conflict-check':    runConflictCheck,
  '/api/send-message':          sendMessage,
  '/api/client-send-message':   clientSendMessage,
  '/api/get-conversations':     getConversations,
  '/api/get-messages':          getMessages,
  '/api/send-doc-reminder':     sendDocReminder,
  '/api/process-doc-reminders': processDocReminders,
  '/api/get-doc-templates':     getDocTemplates,
  '/api/save-doc-template':     saveDocTemplate,
  '/api/analyze-document':      analyzeDocument,
  '/api/calendar/oauth-url':             calendarOauthUrl,
  '/api/calendar/oauth-callback':        calendarOauthCallback,
  '/api/calendar/outlook-oauth-url':     calendarOutlookOauthUrl,
  '/api/calendar/outlook-oauth-callback': calendarOutlookOauthCallback,
  '/api/calendar/status':                calendarStatus,
  '/api/calendar/disconnect':            calendarDisconnect,
  '/api/calendar/events':                calendarEvents,
  '/api/reset-user-password':            resetUserPassword,
  '/api/delete-user':                    deleteUser,
  '/api/process-message-notifications':  processMessageNotifications,
  '/api/drafting/generate':              draftingGenerate,
  '/api/drafting/toggle-final':          draftingToggleFinal,
  '/api/calendar/ical-feed':             calendarIcalFeed,
  '/api/calendar/ical-token':            calendarIcalToken,
};

const HTML_REWRITES = {
  '/portal': '/portal.html',
  '/reset-password': '/reset-password.html',
};

// ── Security headers ──────────────────────────────────────────────────────────
function addSecurityHeaders(response) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return response;
  const h = new Headers(response.headers);
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  h.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 14 * * *') {
      // Daily 9am CST — process document reminders
      ctx.waitUntil(runDocReminders(env));
    } else if (event.cron === '*/5 * * * *') {
      // Every 5 min — debounced message notifications to clients
      ctx.waitUntil(runMessageNotifications(env));
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const handler = routes[url.pathname];
    if (handler) {
      return handler({ request, env, params: {}, data: {} });
    }
    // Rewrite clean URLs to .html files (avoids relying on _redirects from Worker code)
    const rewrite = HTML_REWRITES[url.pathname] ||
      (url.pathname.startsWith('/portal/') ? '/portal.html' : null);
    if (rewrite) {
      return addSecurityHeaders(await env.ASSETS.fetch(new Request(new URL(rewrite, url.origin), request)));
    }
    return addSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
