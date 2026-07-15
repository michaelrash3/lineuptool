# Lineup Tool

An all-in-one, season-long command center for the coaching staff of a youth-baseball team — lineups and game day, roster and player development, evaluations, practices, scheduling, stats, tournaments, tryouts, and team finances in one place. Real-time multi-coach via Firebase; installable to the home screen as a PWA.

The whole signed-in app is **coach-facing**, split into two roles — **head** and **assistant**. Parents are not accounts: they interact only through public, write-only intake portals (tryout signup, player info, availability) that can read nothing but sanitized team branding.

> The app is branded **The Bench Coach** in the UI. The repository name and the npm package both use `lineuptool` for historical reasons.

## What it does

**Roster & players**

- Roster management with positions, bats/throws, jersey numbers, and health/injury status
- Roster-integrity checks — duplicate-number and age-eligibility flags, roster cap with a finalize/lock control
- Player development plans (goals, focus areas, assigned drills, dated check-ins) plus printable development and season reports
- Past-season archives and a guided season rollover ("advance season")

**Lineups & game day**

- Fairness-aware lineup engine: inning-by-inning defense, bench rotation with a minimum-play floor, and a strategy-aware batting order; position locks and saved templates
- Optimal-lineup preview, a **What-If sandbox** (explore availability scenarios and A/B compare two variants, then apply one to the game — syncing attendance), and plain-English **lineup rationale**
- In-game mode: live position swaps, score tracking, and pitching changes; printable/shareable lineup cards (PDF/PNG)
- Pitch-count & arm-care management — age-based limits, rest rules, and cross-game tournament pitch plans

**Schedule & stats**

- Games and events with date/time/location/home-away; ICS and GameChanger schedule import, calendar-feed sync, game-day weather, and reminder drafts
- Depth chart; season stats (GameChanger CSV import), leaders, trends, a season report, and auto-generated awards
- Tournaments: weekend grouping, format/tiebreaker tracking, and cross-game pitching plans

**Evaluations & practices**

- Schema-versioned evaluation rounds with head + assistant workflows, compare/trend views, and roster decisions with offer/rejection letter drafts
- Practice planner with a reusable drill library, attendance tracking, and a weakness-weighted plan generator

**Intake portals (parent-facing)**

- Public tryout signup with showcase-station measurements and a ranking board; year-round interest leads
- Player-info (sizing/logistics) intake and an availability/absence portal — all anonymous and write-only

**Finances (treasurer)**

- Budget planner, team-fee collection, an audit-stamped ledger, sponsorships, reimbursements, month-end reconciliation, and PDF fee sheets / year-end treasurer report

**Platform**

- Real-time multi-coach via Firestore; installable PWA (add-to-home-screen)
- Head/assistant roles enforced both client-side and in Firestore rules; per-team feature toggles hide unused modules
- Client-side JSON backup/restore, with an automatic snapshot taken before destructive actions (season rollover, restore, delete)

## Tech stack

- **React 18** + **TypeScript**, built with **Vite**
- **Firebase 12** — Auth + Firestore (Spark plan; no Cloud Storage). The team logo is the only image and is auto-downscaled/compressed to a small inline data URL on upload; player photos are not stored (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#images))
- **react-router-dom 6** for routing (coach tabs + the public intake portals)
- **Tailwind CSS 3** for styling, with the design tokens centralized in `src/styles.css`
- **lucide-react** for iconography (see `src/icons.tsx`)
- **jspdf** for PDF export (lineup cards, fee sheets, treasurer/roster/eval reports); **recharts** + custom SVG charts for analytics; **qrcode** for portal share links
- **vite-plugin-pwa** — precached app shell + installable manifest (data still needs the network)
- **Vitest** (jsdom) test runner; **@firebase/rules-unit-testing** for the Firestore rules suite (`firestore-tests/`)

## Quickstart

```bash
npm install
npm start          # Vite dev server on http://localhost:3000 (alias: npm run dev)
npm run test:watch # Vitest watch mode
npm test           # one-shot test run (vitest run)
npm run build      # production Vite build into ./dist
npm run preview    # serve the production build locally
```

Firebase configuration is read at runtime from `src/firebase.ts`. For local development against a real project you need a populated `.env` (see `docs/firebase-webapp-configuration.md`); for emulator-driven testing follow `docs/firebase-rules-rollout.md`.

Error monitoring is optional: set `VITE_SENTRY_DSN` in the build environment to forward reported errors (ErrorBoundary catches + global handlers) to Sentry. When unset, no Sentry SDK is loaded and reporting just logs to the console.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — data model, client layout, state flow, EVAL schema migrations
- **[docs/USER-FLOWS.md](docs/USER-FLOWS.md)** — sequence walk-throughs for first sign-in, join-by-code, tryouts, eval rounds, in-game lineup
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — branch conventions, test expectations, rules-rollout dance
- **[docs/firebase-rules-rollout.md](docs/firebase-rules-rollout.md)** — Firestore + Storage rules deploy and emulator matrix
- **[docs/firebase-webapp-configuration.md](docs/firebase-webapp-configuration.md)** — Firebase Auth and OAuth redirect setup

## Repository layout

```
src/
  App.tsx                  # MainShell + top-level routing and role/feature gating
  providers/               # TeamProvider (team state, Firestore subscriptions, mutations), UIProvider, ToastProvider
  contexts.ts              # useTeam / useUI / useToast hooks
  firebase.ts              # Firebase init (auth, db)
  types.ts                 # Central TypeScript data model
  constants/               # DEFAULT_TEAM_DATA, EVAL_SCHEMA_VERSION, feature catalog, finance categories
  lineupEngine.ts +        # Pure-function lineup generator (barrel + lineupEngine/ internals; heavily tested)
    lineupEngine/
  hooks/                   # Extracted CRUD + orchestration (players, games, evals, tryouts, membership, import/export)
  screens/                 # One file per tab, plus sub-page folders (home, roster, schedule, evaluation,
                           #   practices, settings, tryouts, finances) and the three public portals
  components/              # Chrome (login/header/nav), shared primitives, panels (pitching, arm-care,
                           #   development, tournament, analytics), OnboardingTutorial, PlayerProfilePage
  finances/ roster/        # jsPDF generators (treasurer report, fee sheet, roster directory, eval round)
    evaluation/ lineup/
  utils/                   # Pure helpers (dates, stats, availability, finances, backup, rosterIntegrity, …)
  styles.css               # Design tokens (team triplet, slate scale, type, shadows)
  icons.tsx                # Lucide re-exports + a few sport SVGs
firestore.rules            # Firestore security rules (deploy from repo)
public/manifest.json       # PWA manifest
docs/                      # See list above
```

## License

Private project. No license is granted for redistribution.
