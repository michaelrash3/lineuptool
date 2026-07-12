# Architecture

This document describes how the Lineup Tool client is structured, what shape the Firestore data takes, and where the load-bearing pieces live. It's the orientation reference for anyone (human or AI) opening the codebase for the first time.

## Data model

The app uses Firebase Auth (Google + email-link) and three Firestore namespaces under a fixed `artifacts/{appId}` prefix. `appId` defaults to the literal string `"baseball_lineup_v1"` (overridable via a host-injected `window.__app_id`; see the bottom of `src/firebase.ts`).

### `artifacts/{appId}/public/data/teams/{teamId}`

The canonical team document. Every screen reads and writes through this single document — there are **no subcollections**. The full shape is defined by `DEFAULT_TEAM_DATA` in `src/constants/ui.ts`.

Key fields:

| Field                                                            | Type                               | Purpose                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                                           | string                             | Display name                                                                                                                                                                             |
| `ownerId`                                                        | string (uid)                       | Head coach who created the team                                                                                                                                                          |
| `members`                                                        | string[]                           | Sign-in uids permitted to read/write                                                                                                                                                     |
| `coachRoles`                                                     | `{ [uid]: "head" \| "assistant" }` | Role assignments                                                                                                                                                                         |
| `joinCode`                                                       | string (6 chars, `[A-HJ-NP-Z2-9]`) | Self-join code                                                                                                                                                                           |
| `primaryColor` / `secondaryColor` / `tertiaryColor`              | `#rrggbb`                          | User-customizable team palette (Settings → Team Colors). The active team's triplet is pushed to CSS custom properties at runtime, so every `--team-primary` consumer updates reactively. |
| `logoUrl`                                                        | string                             | Team logo, stored inline as a downscaled/compressed data URL (see Images below). Old teams may still hold a legacy Cloud Storage URL, which keeps rendering.                             |
| `teamAge`, `leagueRuleSet`, `defenseSize`, `pitchingFormat`      | enums                              | Engine inputs                                                                                                                                                                            |
| `players`                                                        | object[]                           | Roster — each entry carries `stats`, `pitching`, `comfortablePositions`, `restrictions`, `playerStatus` (no photo; see Images below)                                                     |
| `games`                                                          | object[]                           | Schedule + lineups + final box scores. Slimmed before persistence (see `slimGame` in `src/utils/helpers.ts`) so embedded player objects don't push the doc near the 1 MB cap.            |
| `evaluationEvents`                                               | object[]                           | Eval rounds, schema-versioned (see migration ladder below)                                                                                                                               |
| `evalSchemaVersion`                                              | number                             | Bumped when the schema changes; clients migrate on read                                                                                                                                  |
| `tryoutsOpen`, `tryoutsPhase`, `tryoutSignups`, `tryoutShareIds` | tryouts state                      | Drive the public portal                                                                                                                                                                  |
| `pastSeasons`                                                    | object[]                           | Stat history surviving `advanceSeason`                                                                                                                                                   |
| `lineupTemplates`                                                | object[]                           | Saved presets                                                                                                                                                                            |

### `artifacts/{appId}/users/{uid}/settings/teams`

Per-user selector document: which teams this user belongs to and which one is active. Written when a team is created, joined, switched, or left.

```ts
{ teams: { id, name }[], activeTeamId: string }
```

### `artifacts/{appId}/public/data/teamPublic/{teamId}`

A **sanitized public mirror** of the team, maintained by the coach client. The
Tryouts Portal is an anonymous-auth surface, but Firestore rules grant read
access per _document_, not per field — so letting the portal read the full team
doc would expose evaluations, other families' contact info, member UIDs, and the
join code. Instead the portal reads this mirror, which carries only branding +
tryout config. The projection (the allowlist) is `buildPublicMirror` in
`src/utils/helpers.ts`: `name`, the color triplet, `logoUrl`, `currentSeason`,
`teamAge`, `tryoutsOpen`, `tryoutsPhase`, `tryoutShareId`, `tryoutDateSlug`,
`tryoutDates`. It **never** contains roster, schedule, evaluations, signups,
members, ownerId, coachRoles, or joinCode.

The mirror is upserted by an effect in `TeamProvider` (`App.tsx`) whenever a
member's active team changes a mirrored field; a JSON guard skips no-op writes,
and the first snapshot backfills the doc for teams created before the mirror
existed. Signups still write to the real team doc by id — those updates don't
require client read access, so they work without exposing the doc.

### Images

The whole team lives in **one** Firestore document, so its 1 MB cap is the
binding storage constraint and inline images are the main thing that can blow
it. The app does **not** initialize Cloud Storage — that keeps the project on
the Firebase Spark plan and avoids a separate rules rollout — so the strategy is
to keep inline bytes small rather than offload them.

- **Team logo** — the only image the app stores. On upload (`uploadLogo` in
  `App.tsx`) it runs through `downscaleImageToDataURL` in
  `src/components/shared.tsx`: an image already within `maxDim` (512) and under
  `targetBytes` (~200 KB) passes through untouched, otherwise it's scaled down
  and re-encoded — preferring WebP (transparency + good compression; PNG
  fallback), stepping quality then dimensions down until it fits. So an
  oversized logo is auto-shrunk instead of rejected. A final headroom check
  (`HARD_LIMIT`) warns rather than letting a near-cap doc fail its write.
- **Player photos** — **not stored.** Earlier releases kept inline base64
  `photoUrl` per player, which was the single biggest contributor to doc size;
  the field was removed. The persistence gate in `App.tsx` strips `photoUrl`
  from every players write, and a one-time per-team reclaim pass drops any
  legacy bytes still on a roster so the next save frees the space. Rosters now
  render initials via `PlayerAvatar` (`getPlayerInitials`).
- **Legacy Cloud Storage URLs** — logos uploaded to Cloud Storage during older
  releases keep rendering from their existing URLs; nothing new is written there.

## Client layout

`src/App.tsx` is intentionally a monolith — about 4,000 lines containing all top-level state, every team mutation, and the auth/Firestore subscriptions. Three patterns make it readable:

1. **Context providers wrap the shell.**
   - `ToastProvider` — at the very top so tryouts portal can post toasts without a team
   - `TeamProvider` — owns team state, Firebase subscriptions, every mutation action
   - `UIProvider` — local UI state (selected game, in-game session, attendance toggles), bridged to `TeamProvider` via a `uiBridge` ref so generate/save actions can read selections without putting them in Firestore
   - All three live in `App.tsx`; consumer hooks (`useTeam`, `useUI`, `useToast`) live in `src/contexts.ts` so screens import only the hook.

2. **Screen components live in `src/screens/`** and consume `useTeam()` / `useUI()`. Each tab is a single file:
   - `HomeTab.tsx`, `RosterTab.tsx`, `ScheduleTab.tsx`, `LineupGrid.tsx`, `EvaluationTab.tsx`, `SettingsTab.tsx`, `TryoutsTab.tsx`, `AssistantEvalTab.tsx`
   - `InGameView.tsx` is a full-bleed overlay (not a route) — opened when the user enters game-day mode
   - `TryoutsPortal.tsx` is mounted on a separate route that bypasses `TeamProvider` entirely (anonymous-auth public surface)

3. **Hooks under `src/hooks/`** carry extracted concern sets that don't need to live in `App.tsx`:
   - `useTeamMembership.ts` — head/assistant role plumbing, view-as toggle
   - `useInviteFlows.ts` — `regenerateJoinCode`, `joinTeamByCode`
   - `useImportExportFlows.ts` — CSV import/export, backup JSON
   - `useMainShellRouting.ts` — keeps the active tab in sync with the URL

4. **Reusable components under `src/components/`:**
   - `Chrome.tsx` — `LoginScreen`, `AppHeader`, `TabBarNav`
   - `shared.tsx` — `Button`, `Chip`, `Eyebrow`, `PlayerAvatar`, `RecordBadge`, `Modal`, `A11yDialog`, plus the image helpers (`downscaleImageToDataURL`, `extractLogoPalette`)
   - `PlayerProfilePage.tsx` — the routed player profile (`/roster/:playerId`); every former modal is a routed page under `src/screens/` per the app-wide modals→pages rule
   - `OnboardingTutorial.tsx` — 7-step CTA tour, gated by `lineuptool.onboardingComplete.v2` in localStorage
   - `CommandPalette.tsx` — ⌘K
   - `EvalGradeCard.tsx` — eval grading card
   - (first-run Join-vs-Create lives at `src/screens/WelcomePage.tsx`, the routed `/welcome` page)

## Desktop layout (control-panel spec)

Screens are authored mobile-first (the vast majority of responsive classes are
`sm:`). On wide desktops that left every tab as one stretched, edge-to-edge
column. The desktop direction is a **control panel**: each tab composes its
sections into side-by-side panels so a coach sees more at a glance. The rollout
is **one tab per PR**; this spec is the shared contract that keeps them
consistent. (A previous attempt — a single content-agnostic
`auto-fit`/`grid-auto-flow: dense` `.dashboard-shell` with opt-in span classes —
produced ragged, inconsistent layouts and was reverted in PR #384. Don't bring it
back.)

Rules:

- **Desktop-only, behind `lg:` (≥1024px).** Phone/tablet keep today's single
  column; a layout PR's `<lg` rendering must stay byte-identical. Every layout
  class is `lg:`-prefixed.
- **Shared canvas.** The content column is capped and centered once, at the
  `<main>` in `src/App.tsx` (`lg:max-w-[1440px] lg:mx-auto`) — not per tab — so
  every screen shares the same width and gutters.
- **Designed compositions, not algorithms.** Hand-place each panel
  (`lg:flex`/`lg:grid` with explicit `lg:col-span-*` or independent flex
  columns). Never `auto-fit` or `grid-auto-flow: dense`. Prefer **independent
  flex columns** (`lg:flex lg:items-start`) for a main + rail split — a shared
  CSS-grid row makes a tall column stretch its neighbor's rows and leave gaps,
  which is what looked broken before.
- **Panels reuse the existing primitives.** `GlassCard` / `.glass` and the
  semantic type classes (`.t-h1`, `.t-eyebrow`, `.t-body`) in
  `src/components/shared.tsx` / `src/styles.css`. Apply panel chrome with `lg:`
  utilities (`lg:border lg:border-line lg:rounded-2xl lg:bg-surface lg:p-5`) so
  the mobile markup is untouched. Don't invent a new card system.
- **Put content where its width wants to be.** Data-dense, already-gridded
  sections (insight-tile rows, leaderboards, the `This Week` strip) stay
  full-width; compact summaries (record, coaches) go in a `lg:w-[22rem]` rail.

**Reference implementation — `HomeTab` (`src/screens/HomeTab.tsx`):** the
next-game hero is the main column (`lg:flex-1`) beside a rail
(`lg:w-[22rem]`) holding the season record and coaches as `lg:` panels; the
`This Week` strip, insight tiles, and leaderboards remain full-width. Copy this
pattern for the next tab.

## State flow

```
Firestore                      App.tsx                Context           Screens
─────────                      ───────                ───────           ───────
teams collection  ─onSnapshot→ teamData state ─────→  TeamContext ────→ useTeam().team
users/.../teams   ─onSnapshot→ teams state ──────────→ TeamContext ────→ useTeam().teams

Screen action     ←useTeam()── action callback ─────→ persistTeam() ──→ setDoc(..., merge:true)
                                                                      └→ teamData state (optimistic)
```

- **Reads** stream in via two `onSnapshot` subscriptions in `TeamProvider`: one for the user's team list, one for the active team document.
- **Writes** go through `persistTeam(updates)` (or `updateTeam` for optimistic UI). It slims `games` first, scrubs `undefined`, sets `syncStatus: "Saving"`, and commits with `{ merge: true }`.
- **Array writes are concurrency-safe.** Mutations to the high-traffic team arrays — `players`, `games`, `evaluationEvents`, `practices`, and the tryout-season arrays (`tryoutSignups`, `interestSignups`, `playerInfoSubmissions`, `availabilitySubmissions`, `tryoutSessions`) — go through `updateTeamArrays` (op-based: append → `arrayUnion`, removeById → `arrayRemove`, mapEntries → one-array replace from the latest committed state; see `src/utils/teamArrayUpdates.ts`), and finance mutations through the analogous `updateFinances` (`src/utils/financeUpdates.ts`). Two coaches editing near-simultaneously can no longer erase each other's changes — nor can a coach edit erase an anonymous portal submission appending to the same tryout array. A multi-op list becomes one merged `updateDoc`, which keeps cascades like remove-player or convert-interest atomic. Both paths preserve `persistTeam`'s gates (game slimming, `photoUrl` strip, roster-wipe guard) and its optimistic apply + guarded revert.
- **The active-team subscription retries once** on `permission-denied` — that catches the race where a fresh `members` write hasn't propagated to the rules engine yet.

## Firestore rules → flows

`firestore.rules` (~280 lines) encodes four overlapping permission lanes on the team doc:

1. **Owner/member**: full read/write (`allow read, write: if isMember(resource.data)`)
2. **Bootstrap**: `allow create` when `ownerId` matches the caller — used by `createTeam` and the `bootstrapDefaultTeam` fallback
3. **Join by code**: `allow update` when only `members` + `coachRoles` change and the team has a `joinCode` — used by `joinTeamByCode` in `src/hooks/useInviteFlows.ts`
4. **Public tryouts**: `allow update` when only `tryoutSignups` changes and `tryoutsOpen == true` (and a sibling lane for `interestSignups`) — used by `TryoutsPortal.tsx` (anonymous-auth). There is deliberately **no** public _read_ of the team doc; the portal reads branding/config from the `teamPublic` mirror instead. The mirror has its own match block: `allow read` for any signed-in caller, `allow write` only for a member of the underlying team (verified via a `get()` on the real team doc).

User settings docs are uid-scoped: `allow read, write: if request.auth.uid == uid`.

## EVAL schema migration ladder

The evaluation system has migrated repeatedly (currently through v11). The migration runs on read in the active-team subscription (`src/providers/TeamProvider.tsx`, the `handleSnap` schema-migration block). Representative steps:

| From                             | To                                                     | Behavior                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1 (6-category)                  | v3                                                     | Rounds are wiped — no clean mapping                                                                                                                                |
| v2 (1–10, 11 categories)         | v3 (1–5, 11 categories)                                | Halve every numeric grade, preserve notes                                                                                                                          |
| v3 (position via `restrictions`) | v4 (position via `comfortablePositions` + `isCatcher`) | Flip negative → positive model; engine still consults `restrictions` as a one-release fallback                                                                     |
| v10 (tryout grades on two docs)  | v11 (tryout grades only in `tryoutSessions`)           | Fold legacy `evaluationEvents` tryout grades into `tryoutSessions` once, drop them from `evaluationEvents` (`migrateLegacyTryoutGrades`; EVALUATIONS-AUDIT.md 3.2) |

`EVAL_SCHEMA_VERSION` lives in `src/constants/ui.ts`. After migration the new shape is written back to Firestore so subsequent reads skip the upgrade.

## First-run UX

A brand-new signed-in user has no team yet. Instead of auto-creating "My Team" (which produced throwaway teams for anyone whose intent was to join via a code), `TeamProvider` exposes `needsWelcomeChooser` and `MainShell` redirects every path to the full-screen `/welcome` page (`WelcomePage`) with both Join and Create paths visible. The page is inescapable until one action succeeds; once `teams.length > 0` the wildcard route bounces `/welcome` home. `?join=<code>` URLs still bypass the welcome page entirely — those land in the join redemption effect which can also fall back to `bootstrapDefaultTeam()` on lookup failure.

## Where things are NOT

- **No subcollections.** Roster, schedule, eval history all live on the single team document. Adding a subcollection has been considered for `tryoutSignups` (write-heavy on portal opens) but isn't done.
- **Service worker / PWA.** `vite-plugin-pwa` (`registerType: "autoUpdate"`) registers a Workbox service worker that pre-caches the JS/CSS bundle and app shell. Firestore still needs network for live data — the SW covers the app shell only, not data offline. `manifest.json` also enables Add to Home Screen.
- **No Cloud Functions.** Everything is client + rules.
- **No state management library.** Two React contexts and `useReducer`-free `useState`/`useCallback` patterns carry it.
- **No CSS-in-JS.** Tokens in `src/styles.css`, components style with Tailwind + the `t-*` semantic classes.
