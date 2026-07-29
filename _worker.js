import { onRequest as confirmUpload } from './functions/api/confirm-upload.js';
import { onRequest as createSignatureRequest } from './functions/api/create-signature-request.js';
import { onRequest as declineSignature } from './functions/api/decline-signature.js';
import { onRequest as deleteDocument } from './functions/api/delete-document.js';
import { onRequest as restoreDocument } from './functions/api/restore-document.js';
import { onRequest as purgeTrash } from './functions/api/purge-trash.js';
import { runTrashPurge } from './functions/api/_trash.js';
import { onRequest as getVersionUrl } from './functions/api/get-version-url.js';
import { onRequest as restoreVersion } from './functions/api/restore-version.js';
import { onRequest as newDocumentFromTemplate } from './functions/api/new-document-from-template.js';
import { onRequest as moveDocument } from './functions/api/move-document.js';
import { onRequest as getDownloadUrl } from './functions/api/get-download-url.js';
import { onRequest as getSignatureRequest } from './functions/api/get-signature-request.js';
import { onRequest as getUploadUrl } from './functions/api/get-upload-url.js';
import { onRequest as uploadProxy }  from './functions/api/upload-proxy.js';
import { onRequest as inviteClient } from './functions/api/invite-client.js';
import { onRequest as inviteUser } from './functions/api/invite-user.js';
import { onRequest as sendIntake } from './functions/api/send-intake.js';
import { onRequest as intakePublicLoad } from './functions/api/intake-public-load.js';
import { onRequest as intakePublicSubmit } from './functions/api/intake-public-submit.js';
// Client self-service intake (ported 2026-07-02 in e66871e). These auto-routed
// under Pages Functions and were never added to the table below, so every one of
// them 404'd from the day they landed — see the route-coverage test.
import { onRequest as clientIntakeOpposingParty }   from './functions/api/client-intake-opposing-party.js';
import { onRequest as clientIntakeOpposingCounsel } from './functions/api/client-intake-opposing-counsel.js';
import { onRequest as clientIntakeChild }           from './functions/api/client-intake-child.js';
import { onRequest as clientIntakePrevMarriage }    from './functions/api/client-intake-prev-marriage.js';
import { onRequest as clientIntakeChildOther }      from './functions/api/client-intake-child-other.js';
import { onRequest as clientIntakeFinancial }       from './functions/api/client-intake-financial.js';
import { onRequest as clientIntakeMatter }          from './functions/api/client-intake-matter.js';
import { onRequest as clientIntakeSubmit }          from './functions/api/client-intake-submit.js';
import { onRequest as saveDraftTemplateAttorney }   from './functions/api/save-draft-template-attorney.js';
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
import { run as runRecurringCharges }        from './functions/api/process-recurring-charges.js';
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
import { onRequest as updatePassword }              from './functions/api/update-password.js';
import { onRequest as deleteUser }                   from './functions/api/delete-user.js';
import { onRequest as processMessageNotifications, run as runMessageNotifications } from './functions/api/process-message-notifications.js';
import { onRequest as draftingGenerate }            from './functions/api/drafting-generate.js';
import { onRequest as draftingToggleFinal }         from './functions/api/drafting-toggle-final.js';
import { onRequest as draftingOpen }                from './functions/api/drafting-open.js';
import { onRequest as draftingUploadTemplate }      from './functions/api/drafting-upload-template.js';
import { onRequest as webDAVHandler }               from './functions/api/webdav.js';
import { onRequest as officeEditOpen }              from './functions/api/office-edit-open.js';
import { onRequest as matterFolders }               from './functions/api/matter-folders.js';
import { onRequest as storagePushDocument }         from './functions/api/storage-push-document.js';
import { onRequest as calendarIcalFeed }            from './functions/api/calendar-ical-feed.js';
import { onRequest as calendarIcalToken }           from './functions/api/calendar-ical-token.js';
import { onRequest as mfaStoreRecovery }            from './functions/api/mfa-store-recovery.js';
import { onRequest as mfaRecover }                  from './functions/api/mfa-recover.js';
import { onRequest as getAttorneySig }              from './functions/api/get-attorney-signature.js';
import { onRequest as saveAttorneySig }             from './functions/api/save-attorney-signature.js';
import { onRequest as listSignatures }              from './functions/api/list-signatures.js';
import { onRequest as proofScan }                   from './functions/api/proof-scan.js';
import { onRequest as proofScanHistory }            from './functions/api/proof-scan-history.js';
import { onRequest as proofScanConfig }             from './functions/api/proof-scan-config.js';
import { onRequest as translationStart, runTranslationTmpCleanup } from './functions/api/translation-start.js';
import { onRequest as translationProcess }          from './functions/api/translation-process.js';
import { onRequest as translationPoll }             from './functions/api/translation-poll.js';
import { onRequest as translationDownload }         from './functions/api/translation-download.js';
import { onRequest as translationToPdf }            from './functions/api/translation-topdf.js';
import { onRequest as translationHistory }          from './functions/api/translation-history.js';
import { onRequest as getUnbilledTime }             from './functions/api/get-unbilled-time.js';
import { onRequest as addTimeEntry }                from './functions/api/add-time-entry.js';
import { onRequest as updateDraftInvoice }          from './functions/api/update-draft-invoice.js';
import { onRequest as clientInvoices }              from './functions/api/client-invoices.js';
import { onRequest as createInvoice }               from './functions/api/create-invoice.js';
import { onRequest as sendInvoice }                 from './functions/api/send-invoice.js';
import { onRequest as resendInvoice }               from './functions/api/resend-invoice.js';
import { onRequest as getInvoices }                 from './functions/api/get-invoices.js';
import { onRequest as invoicePaymentWebhook }       from './functions/api/invoice-payment-webhook.js';
import { onRequest as requestRetainer }             from './functions/api/request-retainer.js';
import { onRequest as voidInvoice }                 from './functions/api/void-invoice.js';
import { onRequest as releaseInvoiceTrust }         from './functions/api/release-invoice-trust.js';
import { onRequest as fbUnpaidInvoices }            from './functions/api/fb-unpaid-invoices.js';
import { onRequest as mirrorFbInvoice }             from './functions/api/mirror-fb-invoice.js';
import { onRequest as freshbooksOauthUrl }          from './functions/api/freshbooks-oauth-url.js';
import { onRequest as freshbooksOauthCallback }     from './functions/api/freshbooks-oauth-callback.js';
import { onRequest as freshbooksStatus }            from './functions/api/freshbooks-status.js';
import { onRequest as freshbooksDisconnect }        from './functions/api/freshbooks-disconnect.js';
import { onRequest as billingRates }                from './functions/api/billing-rates.js';
import { onRequest as demoEvent }                   from './functions/api/demo-event.js';
import { onRequest as demoStats }                   from './functions/api/demo-stats.js';
import { onRequest as helpChat }                    from './functions/api/help-chat.js';
import { onRequest as updateAvatar }               from './functions/api/update-avatar.js';
import { onRequest as setMatterStage }             from './functions/api/set-matter-stage.js';
import { onRequest as formFillerPackage }          from './functions/api/form-filler-package.js';
import { onRequest as formFillerGenerate }         from './functions/api/form-filler-generate.js';
import { onRequest as formFillerDownload }         from './functions/api/form-filler-download.js';
import { onRequest as formFillerFinalize }         from './functions/api/form-filler-finalize.js';
import { onRequest as formFillerReset }            from './functions/api/form-filler-reset.js';
import { onRequest as formFillerTemplateDefaults } from './functions/api/form-filler-template-defaults.js';
import { onRequest as formFillerFields }           from './functions/api/form-filler-fields.js';
import { onRequest as formFillerMatterForms }      from './functions/api/form-filler-matter-forms.js';
import { onRequest as caseBuilderPackages }        from './functions/api/case-builder-packages.js';
import { onRequest as caseBuilderCaseType }        from './functions/api/case-builder-case-type.js';
import { onRequest as caseBuilderPackage }         from './functions/api/case-builder-package.js';
import { onRequest as caseBuilderPackageItems }    from './functions/api/case-builder-package-items.js';
import { onRequest as updateMyProfile }            from './functions/api/update-my-profile.js';
import { runStoragePull }                          from './functions/api/_storage-pull.js';
import { onRequest as storageSyncRecon }           from './functions/api/storage-sync-recon.js';
import { onRequest as storageSyncStatus }          from './functions/api/storage-sync-status.js';
import { onRequest as storageSyncUnmatched }       from './functions/api/storage-sync-unmatched.js';
import { onRequest as storageSyncImportClient }    from './functions/api/storage-sync-import-client.js';
import { onRequest as bookingPublic }              from './functions/api/booking-public.js';
import { onRequest as bookingStaff }               from './functions/api/booking-staff.js';
import { runBookingReminders }                     from './functions/api/_booking-reminders.js';

export const routes = {
  '/api/confirm-upload':    confirmUpload,
  '/api/storage-sync-recon':    storageSyncRecon,
  '/api/storage-sync-status':   storageSyncStatus,
  '/api/storage-sync-unmatched': storageSyncUnmatched,
  '/api/storage-sync-import-client': storageSyncImportClient,
  '/api/set-matter-stage':  setMatterStage,
  '/api/form-filler/package':  formFillerPackage,
  '/api/form-filler/generate': formFillerGenerate,
  '/api/form-filler/download': formFillerDownload,
  '/api/form-filler/finalize': formFillerFinalize,
  '/api/form-filler/reset':    formFillerReset,
  '/api/form-filler/template-defaults': formFillerTemplateDefaults,
  '/api/form-filler/fields':   formFillerFields,
  '/api/form-filler/matter-forms': formFillerMatterForms,
  '/api/case-builder/packages':      caseBuilderPackages,
  '/api/case-builder/case-type':     caseBuilderCaseType,
  '/api/case-builder/package':       caseBuilderPackage,
  '/api/case-builder/package-items': caseBuilderPackageItems,
  '/api/update-my-profile': updateMyProfile,
  '/api/create-signature-request': createSignatureRequest,
  '/api/decline-signature': declineSignature,
  '/api/delete-document': deleteDocument,
  '/api/restore-document': restoreDocument,
  '/api/purge-trash': purgeTrash,
  '/api/get-version-url': getVersionUrl,
  '/api/restore-version': restoreVersion,
  '/api/new-document-from-template': newDocumentFromTemplate,
  '/api/move-document': moveDocument,
  '/api/get-download-url': getDownloadUrl,
  '/api/get-signature-request': getSignatureRequest,
  '/api/get-upload-url': getUploadUrl,
  '/api/upload-proxy':   uploadProxy,
  '/api/invite-client': inviteClient,
  '/api/invite-user': inviteUser,
  '/api/send-intake': sendIntake,
  '/api/intake-public-load': intakePublicLoad,
  '/api/intake-public-submit': intakePublicSubmit,
  '/api/client-intake-opposing-party':   clientIntakeOpposingParty,
  '/api/client-intake-opposing-counsel': clientIntakeOpposingCounsel,
  '/api/client-intake-child':            clientIntakeChild,
  '/api/client-intake-prev-marriage':    clientIntakePrevMarriage,
  '/api/client-intake-child-other':      clientIntakeChildOther,
  '/api/client-intake-financial':        clientIntakeFinancial,
  '/api/client-intake-matter':           clientIntakeMatter,
  '/api/client-intake-submit':           clientIntakeSubmit,
  '/api/save-draft-template-attorney':   saveDraftTemplateAttorney,
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
  '/api/update-password':               updatePassword,
  '/api/delete-user':                    deleteUser,
  '/api/process-message-notifications':  processMessageNotifications,
  '/api/drafting/generate':              draftingGenerate,
  '/api/drafting/toggle-final':          draftingToggleFinal,
  '/api/drafting/open':                  draftingOpen,
  '/api/drafting/upload-template':       draftingUploadTemplate,
  '/api/office-edit/open':               officeEditOpen,
  '/api/matter-folders':                 matterFolders,
  '/api/storage-push-document':          storagePushDocument,
  '/api/calendar/ical-feed':             calendarIcalFeed,
  '/api/calendar/ical-token':            calendarIcalToken,
  '/api/mfa-store-recovery':             mfaStoreRecovery,
  '/api/mfa-recover':                    mfaRecover,
  '/api/get-attorney-signature':         getAttorneySig,
  '/api/save-attorney-signature':        saveAttorneySig,
  '/api/list-signatures':                listSignatures,
  '/api/proof-scan':                     proofScan,
  '/api/proof-scan-history':             proofScanHistory,
  '/api/proof-scan-config':              proofScanConfig,
  '/api/translation-start':             translationStart,
  '/api/translation-process':           translationProcess,
  '/api/translation-poll':              translationPoll,
  '/api/translation-download':          translationDownload,
  '/api/translation-topdf':             translationToPdf,
  '/api/translation-history':           translationHistory,
  '/api/get-unbilled-time':             getUnbilledTime,
  '/api/add-time-entry':                addTimeEntry,
  '/api/update-draft-invoice':          updateDraftInvoice,
  '/api/client-invoices':               clientInvoices,
  '/api/create-invoice':                createInvoice,
  '/api/send-invoice':                  sendInvoice,
  '/api/resend-invoice':               resendInvoice,
  '/api/get-invoices':                  getInvoices,
  '/api/invoice-payment-webhook':       invoicePaymentWebhook,
  '/api/request-retainer':              requestRetainer,
  '/api/void-invoice':                  voidInvoice,
  '/api/release-invoice-trust':         releaseInvoiceTrust,
  '/api/fb-unpaid-invoices':            fbUnpaidInvoices,
  '/api/mirror-fb-invoice':             mirrorFbInvoice,
  '/api/freshbooks/oauth-url':          freshbooksOauthUrl,
  '/api/freshbooks/oauth-callback':     freshbooksOauthCallback,
  '/api/freshbooks/status':             freshbooksStatus,
  '/api/freshbooks/disconnect':         freshbooksDisconnect,
  '/api/billing-rates':                 billingRates,
  '/api/demo-event':                    demoEvent,
  '/api/demo-stats':                    demoStats,
  '/api/help-chat':                     helpChat,
  '/api/update-avatar':                 updateAvatar,
  // Public consult-booking surface (scheduling module) — no auth; all are
  // rate-limited below, the mutation is Turnstile-gated inside the handler.
  '/api/booking/attorneys':             bookingPublic,
  '/api/booking/consult-types':         bookingPublic,
  '/api/booking/case-types':            bookingPublic,
  '/api/booking/offer':                 bookingPublic,
  '/api/booking/availability':          bookingPublic,
  '/api/booking/book':                  bookingPublic,
  '/api/booking/staff/cancel':          bookingStaff,
  '/api/booking/staff/payment-link':    bookingStaff,
};

const HTML_REWRITES = {
  '/portal': '/portal.html',
  '/reset-password': '/reset-password.html',
  '/forgot-password': '/forgot-password.html',
  '/account': '/account.html',
  '/intake': '/intake.html',
  '/book': '/book.html',
};

// ── Per-route rate limits ─────────────────────────────────────────────────────
// Maps sensitive API paths to a Workers Rate Limiting binding (declared in
// wrangler.toml as [[ratelimits]]). Keyed per client IP + path, 60-second window.
// Bindings are OPTIONAL: if a client has not added them yet, the check is a no-op
// so existing deployments keep working until they add the blocks and redeploy.
//   RL_STRICT   — auth-sensitive (brute-force / MFA-bypass probing)
//   RL_STANDARD — messaging + email-sending (spam / Resend-quota abuse)
//   RL_BEACON   — high-volume demo analytics beacon (block only egregious bots)
export const RATE_LIMITS = {
  '/api/mfa-recover':          'RL_STRICT',
  '/api/update-password':      'RL_STRICT',
  '/api/reset-user-password':  'RL_STRICT',
  '/api/delete-user':          'RL_STRICT',
  '/api/client-send-message':  'RL_STANDARD',
  '/api/send-message':         'RL_STANDARD',
  '/api/resend-client-access': 'RL_STANDARD',
  '/api/invite-client':        'RL_STANDARD',
  '/api/invite-user':          'RL_STANDARD',
  '/api/send-intake':          'RL_STANDARD',
  '/api/request-retainer':     'RL_STANDARD',
  '/api/intake-public-submit': 'RL_STANDARD',
  '/api/demo-event':           'RL_BEACON',
  // Public booking: the two cheap catalog reads get the loose beacon limit;
  // availability (per-request Graph/Google free-busy call) and book (email +
  // calendar-write) get the standard limit.
  '/api/booking/attorneys':     'RL_BEACON',
  '/api/booking/consult-types': 'RL_BEACON',
  '/api/booking/case-types':    'RL_BEACON',
  '/api/booking/offer':         'RL_STANDARD',
  '/api/booking/availability':  'RL_STANDARD',
  '/api/booking/book':          'RL_STANDARD',
  '/api/booking/staff/cancel':       'RL_STANDARD',
  '/api/booking/staff/payment-link': 'RL_STANDARD',
};

async function checkRateLimit(request, env, pathname) {
  const bindingName = RATE_LIMITS[pathname];
  if (!bindingName) return null;
  const limiter = env[bindingName];
  if (!limiter || typeof limiter.limit !== 'function') return null; // binding not configured — skip
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await limiter.limit({ key: `${pathname}:${ip}` });
    if (!success) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
      );
    }
  } catch (err) {
    // Fail open — never block legitimate traffic if the limiter itself errors.
    console.error('[worker] rate-limit check failed for', pathname, err?.message || err);
  }
  return null;
}

// ── Security headers ──────────────────────────────────────────────────────────
// Canonical CSP — keep this in sync with the `_headers` file (both must match so
// it is irrelevant whether the Worker or the static-asset layer serves the page).
// Notes:
//   • 'unsafe-inline' in script-src is still required because some SPA modules emit
//     inline onclick= handlers (e.g. pages/clients pagination) and index.html has an
//     inline demo-login block. Removing it requires refactoring those to addEventListener
//     + externalizing the index.html script — tracked as follow-up hardening.
//   • connect-src includes R2 (browser fetches presigned download URLs) and Cloudflare
//     Insights (beacon). api.anthropic.com is NOT listed: help-chat calls Claude
//     server-side only, so the browser never connects to it directly.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com https://cloudflareinsights.com",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function addSecurityHeaders(response) {
  const ct = response.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return response;
  const h = new Headers(response.headers);
  h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  h.set('Content-Security-Policy', CSP);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '0 14 * * *') {
      // Daily 9am CST — process document reminders
      ctx.waitUntil(runDocReminders(env));
      // Daily — permanently purge documents that have been in the Trash past
      // the 30-day retention window (removes their R2 objects + version keys).
      ctx.waitUntil(runTrashPurge(env));
      // Daily — remove translation-tmp/ uploads that never got processed
      // (tab closed between translation-start and translation-process).
      ctx.waitUntil(runTranslationTmpCleanup(env));
      // Daily — generate monthly admin-fee draft invoices for any active
      // recurring_charges due today (self-gates by day_of_month + month, so it
      // bills each charge at most once per calendar month).
      ctx.waitUntil(runRecurringCharges(env));
    } else if (event.cron === '*/5 * * * *') {
      // Every 5 min — debounced message notifications to clients
      ctx.waitUntil(runMessageNotifications(env));
      // Every 5 min — Storage Sync pull (no-ops unless the storage_sync
      // premium module is enabled AND a provider's credentials are configured)
      ctx.waitUntil(runStoragePull(env));
      // Every 5 min — consult reminder emails (no-ops unless the scheduling
      // premium module is enabled AND reminders are on in booking_settings)
      ctx.waitUntil(runBookingReminders(env));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // WebDAV paths are dynamic (/webdav/{doc_id}) — handle before exact-match table
    if (url.pathname.startsWith('/webdav/')) {
      try {
        return await webDAVHandler({ request, env, ctx, params: {}, data: {} });
      } catch (err) {
        console.error('[worker] webdav error', err?.message || err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const handler = routes[url.pathname];
    if (handler) {
      const limited = await checkRateLimit(request, env, url.pathname);
      if (limited) return limited;
      try {
        return await handler({ request, env, ctx, params: {}, data: {} });
      } catch (err) {
        console.error('[worker] unhandled error in', url.pathname, err?.message || err);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
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
