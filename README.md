# Lineup Tool

A youth-baseball coaching app for head and assistant coaches: build inning-by-inning lineups, manage in-game swaps, run player evaluations, and keep season stats in one place. Real-time multi-coach via Firebase; install-to-home-screen via PWA.

> The app is branded **Coach's Card** in the UI. The repository name and the npm package both use `lineuptool` for historical reasons.

## Tech stack

- **React 18** + **TypeScript**, built with **Vite**
- **Firebase 12** — Auth + Firestore (Spark plan; no Cloud Storage — player photos are stored inline as data URLs)
- **react-router-dom 6** for routing (tabs + public Tryouts Portal)
- **Tailwind CSS 3** for styling, with the design tokens centralized in `src/styles.css`
- **lucide-react** for iconography (see `src/icons.tsx`)
- **jspdf** for lineup card PDF export
- **Vitest** (jsdom) test runner

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
- **[docs/design/coachs-card/](docs/design/coachs-card/)** — visual design system, tokens, and 22 preview HTML cards

## Repository layout

```
src/
  App.jsx              # MainShell, TeamProvider, UIProvider, top-level routing
  firebase.ts          # Firebase init (auth, db, storage)
  contexts.js          # useTeam / useUI / useToast hooks
  styles.css           # Design tokens (team triplet, slate scale, type, shadows)
  icons.tsx            # Lucide re-exports + a few sport SVGs
  lineupEngine.ts      # Pure-function lineup generator (tested)
  hooks/               # Extracted orchestration (membership, invites, import/export)
  screens/             # Tab screens (Home, Roster, Schedule, Lineup, Eval, Settings, Tryouts)
  components/          # Shell (Chrome), modals, OnboardingTutorial, WelcomeChooser, shared primitives
  utils/               # Pure helpers (date, slimGame, blankStats, etc.)
  constants/ui.ts      # DEFAULT_TEAM_DATA, EVAL_SCHEMA_VERSION, etc.
firestore.rules        # Firestore security rules (deploy from repo)
public/manifest.json   # PWA manifest
docs/                  # See list above
```

## License

Private project. No license is granted for redistribution.
