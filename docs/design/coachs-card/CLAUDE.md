# Claude Code instructions

You are working on **Coach's Card** — a youth-baseball coaching web
app. The repo you should be editing is the project's existing React /
TypeScript codebase (the `michaelrash3/lineuptool` repository if
freshly cloned, or wherever this design bundle has been dropped).

## Read these, in order, before writing any code

1. **`CLAUDE_CODE.md`** in this folder — top-level handoff framing.
2. **`README.md`** in this folder — full per-screen spec, fidelity
   level, asset map, suggested implementation order.
3. **`colors_and_type.css`** — the canonical token source. Every color
   / type / spacing / radius / shadow value to match.
4. **`SOURCE_README.md`** — deeper visual-foundation rationale.
5. **`ICONOGRAPHY.md`** — icon library rules.

## Your job

Reproduce the designs in `preview/01–21-*.html` and
`ui_kits/coachs-card-app/*.jsx` **inside the production codebase**.
Do not ship the HTML directly. Match tokens exactly, recreate
component-by-component using the codebase's existing Tailwind + React
patterns.

## Critical rules

- **Use the three `--team-*` CSS variables for every brand color** —
  never hardcode hex values for team-colored surfaces. The whole app
  must re-theme when a coach changes the three colors in Settings.
- **No dark mode** except inside Game-Day Mode (implemented as
  `src/screens/InGameView.tsx` in the production app) — that surface
  is intentionally dark for outdoor sunlight readability.
- **Use `⭐` for Big Game flags.** `⚡` was retired.
- **Big Game needs a tooltip** explaining what the flag means
  (rivalry / playoff / makeup game). See `preview/19-upcoming-game.html`.
- **Sparklines need a baseline.** When a sparkline shows a team
  trend, include a faint dashed league-average baseline + small
  "League X.XXX" label so a falling line isn't read as catastrophic
  when the team is still well above league. See `.spark-base` /
  `.spark-label` in `preview/20-stat-blocks.html`.
- **Stat surfaces ship with two variants.** Rich (full hero +
  tiles + sparklines) and Stripped (single-row, no chrome). Coach
  picks per surface in Settings. See `preview/20-stat-blocks.html`.
- **Empty states use the sanctioned emoji set** as a watermark
  glyph (⚾ 🧢 📋 ⭐ 📅 📊) — see `preview/22-empty-states.html`.
- **Game-Day Mode auto-engages** when a game is marked live. Dark
  shell, 44+ px touch targets, in-game-only controls, undo persists
  across navigation. See `src/screens/InGameView.tsx` in the
  production app (the preview card for this surface was never added).
- **Dark-on-dark contrast:** when a surface sits on a dark hero
  panel, accents must come from the LIGHTEST of the three team
  colors plus a soft rose (`#FCA5A5`) for danger states — never
  `--team-secondary` if that's a dark color. Reference the
  `.record` block in `preview/20-stat-blocks.html`.
- **All chrome is UPPERCASE + `font-weight: 900` + wide tracking.**
  This is the brand voice — do not weaken it.
- **Retired custom baseball SVGs.** The five files in
  `assets/iconography/` are deprecated. Use Twemoji remote SVGs for
  sport glyphs and Lucide for UI chrome — see `ICONOGRAPHY.md`.

## Workflow

1. Audit existing token plumbing in the repo (`tailwind.config.js`,
   any `theme.css` or `globals.css`). Extend it with the values from
   `colors_and_type.css`. Most slate / emerald / rose / amber values
   already match Tailwind defaults.
2. Add the three `--team-*` CSS variables to `:root` with the
   defaults from `colors_and_type.css`. Make sure they're read from
   the team document in Firestore at render time so changing them in
   Settings instantly re-themes the app.
3. Update `src/icons.tsx` to register the five baseball SVGs in
   `assets/iconography/`.
4. Refresh `src/components/Chrome.jsx` against `preview/14-tab-bar.html`
   and `ui_kits/coachs-card-app/Chrome.jsx`.
5. Refresh `src/screens/HomeTab.jsx` against
   `preview/18`/`19`/`20-*.html` and `ui_kits/.../HomeDashboard.jsx`.
6. Refresh `RosterTab.jsx`, `ScheduleTab.jsx`, `EvaluationTab.jsx`,
   `SettingsTab.jsx`, `InGameView.jsx` using the relevant
   `preview/*.html` cards as specs.
7. Add the **Settings → Team Theme** screen per
   `preview/21-theme-settings.html` — 3 color pickers + logo upload
   + live preview strip, persists to Firestore.

## When you finish

Open `Trash Pandas Theme Preview.html` for a visual reference of what
"a fully themed Coach's Card looks like." If the in-codebase result
doesn't match that level of brand integration when 3 colors + a logo
are pasted in, the theming layer is incomplete.
