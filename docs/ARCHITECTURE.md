# Architecture

This document describes how the Lineup Tool client is structured, what shape the Firestore data takes, and where the load-bearing pieces live. It's the orientation reference for anyone (human or AI) opening the codebase for the first time.

## Data model

The app uses Firebase Auth (Google + email-link) and three Firestore namespaces under a fixed `artifacts/{appId}` prefix. `appId` is the literal string `"lineup-app"` — there is no per-environment override (see `src/firebase.ts:81`).

### `artifacts/{appId}/public/data/teams/{teamId}`

The canonical team document. Every screen reads and writes through this single document — there are **no subcollections**. The full shape is defined by `DEFAULT_TEAM_DATA` in `src/constants/ui.ts`.

Key fields:

| Field | Type | Purpose |
|---|---|---|
| `name` | string | Display name |
| `ownerId` | string (uid) | Head coach who created the team |
| `members` | string[] | Sign-in uids permitted to read/write |
| `coachRoles` | `{ [uid]: "head" \| "assistant" }` | Role assignments |
| `joinCode` | string (6 chars, `[A-HJ-NP-Z2-9]`) | Self-join code |
| `primaryColor` / `secondaryColor` / `tertiaryColor` | `#rrggbb` | User-customizable team palette (Settings → Team Colors). The active team's triplet is pushed to CSS custom properties at runtime, so every `--team-primary` consumer updates reactively. |
| `logoUrl` | string | Team logo (data URL or Storage URL) |
| `teamAge`, `leagueRuleSet`, `defenseSize`, `pitchingFormat` | enums | Engine inputs |
| `players` | object[] | Roster — each entry carries `stats`, `pitching`, `comfortablePositions`, `restrictions`, `photoUrl`, `playerStatus` |
| `games` | object[] | Schedule + lineups + final box scores. Slimmed before persistence (see `slimGame` in `src/utils/helpers.ts`) so embedded player objects don't push the doc near the 1 MB cap. |
| `evaluationEvents` | object[] | Eval rounds, schema-versioned (see migration ladder below) |
| `evalSchemaVersion` | number | Bumped when the schema changes; clients migrate on read |
| `tryoutsOpen`, `tryoutsPhase`, `tryoutSignups`, `tryoutShareIds` | tryouts state | Drive the public portal |
| `pastSeasons` | object[] | Stat history surviving `advanceSeason` |
| `lineupTemplates` | object[] | Saved presets |

### `artifacts/{appId}/users/{uid}/settings/teams`

Per-user selector document: which teams this user belongs to and which one is active. Written when a team is created, joined, switched, or left.

```ts
{ teams: { id, name }[], activeTeamId: string }
```

### Cloud Storage: `teams/{teamId}/players/{photoFile}`

Player photos, JPEG cropped to 256×256 by `cropImageTo256()` in `src/components/shared.jsx`. Rules permit unauthenticated reads (URLs are unguessable) and signed-in writes under 5 MB — see `storage.rules`.

## Client layout

`src/App.jsx` is intentionally a monolith — about 3,600 lines containing all top-level state, every team mutation, and the auth/Firestore subscriptions. Three patterns make it readable:

1. **Context providers wrap the shell.**
   - `ToastProvider` — at the very top so tryouts portal can post toasts without a team
   - `TeamProvider` — owns team state, Firebase subscriptions, every mutation action
   - `UIProvider` — local UI state (selected game, open modals, attendance toggles), bridged to `TeamProvider` via a `uiBridge` ref so generate/save actions can read selections without putting them in Firestore
   - All three live in `App.jsx`; consumer hooks (`useTeam`, `useUI`, `useToast`) live in `src/contexts.js` so screens import only the hook.

2. **Screen components live in `src/screens/`** and consume `useTeam()` / `useUI()`. Each tab is a single file:
   - `HomeTab.jsx`, `RosterTab.jsx`, `ScheduleTab.jsx`, `LineupGrid.jsx`, `EvaluationTab.jsx`, `SettingsTab.jsx`, `TryoutsTab.jsx`, `AssistantEvalTab.jsx`
   - `InGameView.jsx` is a full-bleed overlay (not a route) — opened when the user enters game-day mode
   - `TryoutsPortal.jsx` is mounted on a separate route that bypasses `TeamProvider` entirely (anonymous-auth public surface)

3. **Hooks under `src/hooks/`** carry extracted concern sets that don't need to live in `App.jsx`:
   - `useTeamMembership.js` — head/assistant role plumbing, view-as toggle
   - `useInviteFlows.js` — `regenerateJoinCode`, `joinTeamByCode`
   - `useImportExportFlows.js` — CSV import/export, backup JSON
   - `useMainShellRouting.js` — keeps the active tab in sync with the URL

4. **Reusable components under `src/components/`:**
   - `Chrome.jsx` — `LoginScreen`, `AppHeader`, `TabBarNav`
   - `shared.jsx` — `Button`, `Chip`, `GlassCard`, `Eyebrow`, `StatTile`, `PlayerAvatar`, `RecordBadge`, `LeaderboardCard`, `SharedModals`, plus the photo crop helper
   - `modals.jsx` — `PlayerProfileModal`, `AddPlayerModal`, `PastSeasonImportModal` (large; one file per concern would be nicer but isn't worth the churn yet)
   - `OnboardingTutorial.jsx` — 7-step CTA tour, gated by `lineuptool.onboardingComplete.v2` in localStorage
   - `WelcomeChooser.jsx` — first-run modal that asks Join vs Create instead of auto-creating "My Team"
   - `CommandPalette.jsx` — ⌘K
   - `PitcherRankingPanel.jsx`, `EvalGradeCard.jsx` — eval surfaces

## State flow

```
Firestore                      App.jsx                Context           Screens
─────────                      ───────                ───────           ───────
teams collection  ─onSnapshot→ teamData state ─────→  TeamContext ────→ useTeam().team
users/.../teams   ─onSnapshot→ teams state ──────────→ TeamContext ────→ useTeam().teams

Screen action     ←useTeam()── action callback ─────→ persistTeam() ──→ setDoc(..., merge:true)
                                                                      └→ teamData state (optimistic)
```

- **Reads** stream in via two `onSnapshot` subscriptions in `TeamProvider`: one for the user's team list, one for the active team document.
- **Writes** go through `persistTeam(updates)` (or `updateTeam` for optimistic UI). It slims `games` first, scrubs `undefined`, sets `syncStatus: "Saving"`, and commits with `{ merge: true }`.
- **The active-team subscription retries once** on `permission-denied` — that catches the race where a fresh `members` write hasn't propagated to the rules engine yet.

## Firestore rules → flows

`firestore.rules` is small (~55 lines) but encodes four overlapping permission lanes on the team doc:

1. **Owner/member**: full read/write (`allow read, write: if isMember(resource.data)`)
2. **Bootstrap**: `allow create` when `ownerId` matches the caller — used by `createTeam` and the `bootstrapDefaultTeam` fallback
3. **Join by code**: `allow update` when only `members` + `coachRoles` change and the team has a `joinCode` — used by `joinTeamByCode` in `src/hooks/useInviteFlows.js`
4. **Public tryouts**: `allow update` when only `tryoutSignups` changes and `tryoutsOpen == true` — used by `TryoutsPortal.jsx` (anonymous-auth)

User settings docs are uid-scoped: `allow read, write: if request.auth.uid == uid`.

## EVAL schema migration ladder

The evaluation system has migrated three times. The migration runs on read in the active-team subscription (`App.jsx` around line 471):

| From | To | Behavior |
|---|---|---|
| v1 (6-category) | v3 | Rounds are wiped — no clean mapping |
| v2 (1–10, 11 categories) | v3 (1–5, 11 categories) | Halve every numeric grade, preserve notes |
| v3 (position via `restrictions`) | v4 (position via `comfortablePositions` + `isCatcher`) | Flip negative → positive model; engine still consults `restrictions` as a one-release fallback |

`EVAL_SCHEMA_VERSION` lives in `src/constants/ui.ts`. After migration the new shape is written back to Firestore so subsequent reads skip the upgrade.

## First-run UX

A brand-new signed-in user has no team yet. Instead of auto-creating "My Team" (which produced throwaway teams for anyone whose intent was to join via a code), `TeamProvider` exposes `needsWelcomeChooser` and `MainShell` renders `<WelcomeChooser>` with both Join and Create paths visible. The chooser is non-dismissible until one action succeeds; it auto-closes when `teams.length > 0`. `?join=<code>` URLs still bypass the chooser entirely — those land in the join redemption effect which can also fall back to `bootstrapDefaultTeam()` on lookup failure.

## Where things are NOT

- **No subcollections.** Roster, schedule, eval history all live on the single team document. Adding a subcollection has been considered for `tryoutSignups` (write-heavy on portal opens) but isn't done.
- **No service worker / offline mode.** `manifest.json` enables Add to Home Screen but the app needs network for Firestore.
- **No Cloud Functions.** Everything is client + rules.
- **No state management library.** Two React contexts and `useReducer`-free `useState`/`useCallback` patterns carry it.
- **No CSS-in-JS.** Tokens in `src/styles.css`, components style with Tailwind + the `t-*` semantic classes.
