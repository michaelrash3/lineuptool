# Coach's Card — Web App UI Kit

This is the only UI kit in the system — Coach's Card ships as a single
responsive web app, period. There's no marketing site, no admin surface, no
mobile-native shell.

The kit recreates the visual surface of the production React app. Components
are cosmetic-faithful but stub out the engine logic (no Firebase, no real
lineup generator). Treat it as a pixel reference: drop these JSX components
into a mock to assemble a screen quickly.

## How it loads

`index.html` is a self-contained click-through prototype. It uses:

- **Tailwind via CDN** — same as production (`public/index.html`).
- **React 18.3 + Babel standalone** — for in-browser JSX.
- **Inter via Google Fonts** — the substitute family flagged in the root
  README. Set as `font-family` on the root.
- **Lucide via CDN** (`unpkg.com/lucide@latest`) — provides every generic
  icon. The five baseball-specific SVGs are imported from
  `../../assets/iconography/`.

## Files

```
index.html            ← click-through prototype (Login → Dashboard)
Chrome.jsx            ← AppHeader, TabBarNav, LoginScreen
HomeDashboard.jsx     ← UpcomingGameCard, TeamSummary, LeaderboardCard
mock-data.js          ← Sample team / players / games / coaches
```

The kit deliberately scopes to the Login + Dashboard surfaces only —
they exercise every visual primitive in the system. Roster, Modal,
Toast, Stat Block, etc. live as standalone `preview/*.html` cards
(see `preview/15-roster-row.html`, `preview/16-modal.html`, etc.).
Use those + the JSX patterns here as the translation reference for
the other production screens.

## Screens demonstrated

1. **Login** — full-screen, slate-50 backdrop, accent-strip top, centered
   glass card, Google sign-in CTA.
2. **Home Dashboard** — header chrome → tab bar → upcoming-game card →
   team summary panel → hitting/fielding leaders grid.

For Roster, In-Game, Modal, Toast, Schedule and Settings layouts,
reference the corresponding `preview/*.html` cards in the parent
folder — they specify the same primitives at higher detail and can be
translated to the production codebase in the same idiom as the JSX
files here.

## Coverage gaps (deliberate)

The production app contains five massive screens — Schedule (game editor,
roster import, score editor), Evaluation (six-axis scoring + roster
decisions), and Settings (color picker, CSV import, coach management) — that
are not recreated here. They share the same visual primitives as the
demonstrated screens; the components in `ComponentLibrary.jsx` plus the kit
foundations cover them.

To add a screen, follow the visual rules in the root `README.md` (Visual
Foundations) and lean on the existing primitives. Do not invent new
components without checking what `src/screens/` does in the imported repo.
