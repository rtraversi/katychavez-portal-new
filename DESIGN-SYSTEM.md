# IurisIQ Portal — Design System ("Docket" signature style)

The portal's signature look is the **Docket kit** — the "well-kept case file" system
born on the Home redesign and standardized on **Settings → Scheduling** (2026-07).

**All new UI — pages, modules, components — uses this by default.** Reuse the `.dk-*`
classes straight up; take *inspiration* from the reference page when you need a pattern
that doesn't exist yet. Do not invent a parallel aesthetic.

Reference implementation: `pages/settings/scheduling/` (+ the kit in `css/portal.css`).

---

## Principles
- **Editorial & calm** — "premium legal software." Serif (Lora) display with an *italic*
  accent; Open Sans body; the paper/ink "case file" palette.
- **Token-driven only.** Never hardcode colors or fonts. Everything derives from the hue
  tokens in `css/variables.css`, so **light/dark + all 7 themes come for free.**
- **Structure encodes meaning.** Kicker + ruled section heads; records live in a
  *register*, people in a *roster*, state shows as chips/tags — not decoration.
- **Design both themes**, and verify with a screenshot (Vitest doesn't see the DOM).

## The kit (`.dk-*`, defined at the bottom of `css/portal.css`)
- **Masthead:** `.dk-masthead` / `.dk-kicker` / `.dk-title` (`<em>` = italic accent) / `.dk-sub`
- **Status chips:** `.dk-deskbar` + `.dk-chip` (`.is-live` / `.is-warn` / `.static`; `.n` = count)
- **Sections:** `.dk-sec` + `.dk-sec-head` (h2 + `.dk-sec-rule` + `.dk-sec-add` / `.dk-sec-count`)
- **Records:** `.dk-register` / `.dk-reg-row` / `.dk-reg-title` / `.dk-reg-meta` (`.fee`/`.sep`/`.danger`) / `.dk-reg-act`
- **People:** `.dk-roster` / `.dk-att` (`.who`, `.slug`) + `.dk-week` / `.dk-wd` availability strip
- **Bits:** `.dk-avatar` + `.dk-stack`, `.dk-tag` (`.warn`/`.ok`/`.mut`/`.acc`), `.dk-linkbtn` (`.d` = danger), `.dk-empty`
- **Layout:** `.dk-cols` + `.dk-rail` (sticky rail — *optional*, only when there's second-order content like a live preview). A two-column page auto-widens past the 1200px reading cap to 1600px via `.page-content:has(.dk-cols)`; single-column pages keep the cap.
- **Forms:** `.dk-toggle` (slider — wraps a real checkbox), `.dk-hours` / `.dk-hours-row`, `.dk-fieldrow` (`.lead` / `.trio`)
- **Nested rows:** `.dk-disclosure` (expand chevron) + `.dk-subrows` (`.collapsed`) / `.dk-subrow` — indented sub-items revealed under a register row (e.g. practice-area sub-areas)

## Render helpers (`js/dk.js`, global `window.DK`)
Loaded before page scripts. Use these so markup stays identical across pages:
`DK.masthead({kicker,title,sub})` (put an `<em>` in `title` for the accent) ·
`DK.sectionHead(title, {count, add:{id,label}})` · `DK.deskbar([{n,label,tone,live,static,jump}])`
+ `DK.wireDeskbar()` · `DK.toggle(attrs, checked)` (wraps a real checkbox) ·
`DK.tag(label, kind)` · `DK.avatar(name, seed, size)` / `DK.avatarColor` / `DK.initials`.

## Building a page
1. Masthead → desk chips → ruled sections. Single column unless you have real rail content.
2. **Reuse** kit classes. Extend the kit (add a new `.dk-*`) only for a genuinely new
   pattern, with a comment — never re-inline these patterns per page.
3. Prefer **sliders** for booleans, **register/roster** over ad-hoc `.card` stacks, **tags** for status.
4. **Migrating an existing page:** rewrite only the `render*()` functions and
   **preserve every element `id` + `data-*` the save/wire/delete handlers use.**
   Pure CSS/markup — no DB/API/migration changes, so it's trivially reversible.
5. **Gate before commit:** `node --check` + `npm test` + a headless screenshot in
   **light and dark** (`msedge --headless=new --no-sandbox --screenshot=... file:///...`;
   toggle dark via `data-mode="dark"` on `<html>`).

## Don't
- Don't hardcode hex colors or font families — use the tokens.
- Don't rebuild plain stacked `.card` walls where a register/roster fits.
- Don't force a rail where there's no second content to put in it.
- Don't skip the dark-mode check.

## Rollout status
Migrating the portal to this system **section by section**: Home ✓ → Settings ✓ →
Client card ✓ → core module pages ✓ (tasks · uploads · messaging · draft-forms · billing) →
premium + remaining staff pages ✓ (calendar · conflict-checker · esign · proof-scan ·
appointments · sig-stamp · translation · trust · clients-list · dashboard) →
public/client-facing (client-portal, /book, intake, login) — the only surface left.
Each surface on its own `redesign/<surface>` branch → sandbox → sign-off → merge → deploy.
