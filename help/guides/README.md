# Help guides

In-portal help documents rendered by the shared Help slide-over
(`js/help-drawer.js`). Opened from a page masthead's `.dk-help-btn` or the
top-right avatar menu's **Help & Guides** item. This is separate from the
floating **"Clause"** help-chat assistant.

## How it fits together

| Piece | Role |
|---|---|
| `help/guides/<id>.html` | The guide body — a plain HTML **fragment** (no `<html>`/`<head>`/`<body>`). The canonical source of truth. |
| `js/help-guides.js` | Manifest: one entry per guide (metadata + a `src` pointer). |
| `js/help-drawer.js` | Fetches a guide's `src` on open and renders it; styling scoped under `.help-doc` in `css/portal.css`. |

## Add a new guide

1. **Write the body.** Create `help/guides/<id>.html` as an HTML fragment. Reuse
   the guide styles so it matches: `.help-sec` (section), `.help-callout`,
   `.help-path`, `.help-note`, `.help-flow`, `.help-table` /
   `.help-table-wrap`, and `.dk-tag` chips. See `billing-trust.html` for the
   full vocabulary.
2. **Register it** in `js/help-guides.js`:
   ```js
   window.HELP_GUIDES.push({
     id:       'my-guide',                 // unique; used by HelpDrawer.open('my-guide')
     kicker:   'Area · How it works',
     title:    'My guide title',
     subtitle: 'One-line description.',
     updated:  'Updated Month YYYY',
     summary:  'Blurb shown on the guide index card.',
     src:      '/help/guides/my-guide.html',
   });
   ```
3. **Surface it (optional).** To open it contextually from a page, add a
   masthead button on that page:
   ```html
   <button type="button" class="dk-help-btn"
     onclick="window.HelpDrawer && window.HelpDrawer.open('my-guide')">
     <!-- ? icon --> <span class="dk-help-label">Help</span>
   </button>
   ```
   With two or more guides registered, the avatar-menu entry and a
   "← All guides" back link expose the full index automatically.

## The `src` convention — repo vs R2

`src` is just a URL the drawer fetches, so a guide's body can live wherever fits:

- **Repo path** (`/help/guides/x.html`) — for **staff "how the portal works"**
  docs. They describe portal behaviour, so they version *with* the code. Served
  as a static asset; the drawer cache-busts them with `?v=<deployVersion>`.
- **Absolute URL** (`https://resources.<domain>/…`) — for **client-facing
  "helpful hints" / Library** material served from the planned public
  **resources R2 bucket**. The drawer detects absolute URLs and leaves them
  untouched (no `?v=`), so it won't fight R2's own caching/CORS.

Keep those two concerns separate: staff guides in the repo, client-facing
resources in the dedicated *public* resources bucket — not co-mingled with the
private client-files bucket.

## Editing an existing guide

Edit the `.html` fragment in this folder and redeploy. The repo copy is
authoritative; any external draft (e.g. a Google Doc) is just an origin, not the
source of truth.
