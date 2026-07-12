# User flows

End-to-end sequence walk-throughs for the major flows. Use this alongside `ARCHITECTURE.md` to understand how a click in the UI lands in Firestore.

---

## First sign-in (the common case)

```
User                    LoginScreen           App.tsx              Firestore
────                    ───────────           ───────              ─────────
click Sign In ─────────→ Google popup
                         ├─ success ─→ onAuthStateChanged ──→ setUser(u)
                         │                      │
                         │                      └→ users/{uid}/settings/teams onSnapshot
                         │                          │ (empty)
                         │                          ↓
                         │                       teams=[], needsWelcomeChooser=true
                         │                          ↓
                         │                       /welcome (WelcomePage)
click Create Team ─────────────────────────→ createTeam(name) ─→ setDoc teams/{id}
                                                              ─→ setDoc users/{uid}/settings/teams
                         │                          ↓
                         │                       snapshot fires, teams=[{id,name}]
                         │                          ↓
                         │                       wildcard route bounces /welcome home
                         │                          ↓
                         │                       OnboardingTutorial opens (first time only)
```

Failure modes:

- Popup blocked / closed: handler counts consecutive dismissals; on the 2nd one a tip about third-party cookies / in-app browsers surfaces in the bottom-left error toast.
- `createTeam` Firestore error: toast pushed, chooser shows inline error, stays open for retry.
- `joinTeamByCode` invalid code: chooser shows "Code not recognized." stays open.

---

## Join an existing team (head coach already set it up)

Two entrypoints lead to the same effect:

1. **Via the /welcome page** (the brand-new user case above): code field + Join Team button.
2. **Via the header** (a user who already has a team): `AppHeader` → "Join Team" → 6-char input.

Both routes call `joinTeamByCode(rawCode)` in `src/hooks/useInviteFlows.js`:

```
joinTeamByCode(code)
  ├─ validate /^[A-HJ-NP-Z2-9]{6}$/
  ├─ check teams the user already belongs to (fast path: switch instead of join)
  ├─ Firestore query: teams where joinCode == code
  │   └─ append uid to members + coachRoles[uid]="assistant" (head stays head)
  ├─ update users/{uid}/settings/teams to include the new team + make it active
  └─ switchTeam(teamId)
```

The active-team subscription has a one-shot retry on `permission-denied` because membership changes haven't always propagated to the rules engine by the time the snapshot fires.

---

## Join via emailed link (`?join=<code>`)

The legacy `?invite=` token flow was retired (PR #117); only the durable 6-char codes work now. When a coach taps an emailed link before signing in:

```
?join=ABC234 in URL
  └─ App.tsx puts ABC234 into sessionStorage("pendingJoin")
     and bypasses the /welcome page (needsWelcomeChooser=false)
  ↓
sign in
  ↓
auth ready effect at App.tsx ~2576:
  ├─ joinTeamByCode(pendingJoin)
  ├─ if join fails (unknown code, denied lookup): bootstrapDefaultTeam()
  │    so the user lands somewhere useful instead of staring at an empty shell
  └─ clear pendingJoin
```

---

## Public Tryouts Portal (anonymous parents)

The Tryouts Portal is mounted on `/tryouts-portal/:slug` and renders **outside** `TeamProvider` (see `App.tsx` near the `App` component). It uses anonymous Firebase auth to satisfy the rule that the caller be signed in. The team rules permit a single field append:

```
parent opens /tryouts-portal/<slug>
  ├─ signInAnonymously (if not already signed in)
  ├─ read team doc by joinCode/shareId → render themed signup form
  ├─ submit:
  │    setDoc teams/{id} { tryoutSignups: [...existing, newRow] } merge=true
  │    └─ Firestore rule allows the update only because:
  │         - signed in (anonymous counts)
  │         - tryoutsOpen == true
  │         - diff.affectedKeys.hasOnly(['tryoutSignups'])
  └─ success toast; portal continues to accept further signups
```

When the head coach toggles `tryoutsOpen` off, the same submit returns a permission-denied error.

---

## Eval round (head coach grades after a game)

```
EvaluationTab → New Round
  ├─ pick category set (hitting / fielding / pitching)
  ├─ for each player, set 1–5 grade per dimension + optional notes
  └─ Save Round
       ├─ saveTeamEvaluation in App.tsx
       │    ├─ push event to teamData.evaluationEvents
       │    └─ persistTeam({ evaluationEvents: [...], evalSchemaVersion: 4 })
       └─ EvaluationTab leaderboards + sparklines recompute from the
          updated events list
```

Assistant coaches use `AssistantEvalTab.tsx` instead — same shape, but the head reviews and finalizes before the event is committed to the canonical events array.

---

## In-game lineup (game day)

```
Home → Live Game card
  └─ <InGameView open game={...}> renders as a full-bleed overlay (not a route).
     ├─ Tap any defensive cell → swap player (yellow ring indicates pending swap target)
     ├─ Alert button: handle a mid-game injury, prorate fairness, mark player removed
     ├─ Undo: pre-swap snapshot, restorable for the duration of the inning
     └─ Save & Finalize:
          ├─ finalizeGame(gameId, score) ─→ persistTeam({ games: [...updated] })
          ├─ archive lineup snapshots
          └─ unlock the Evaluation prompt on Home
```

Game day also drives `record` (W/L/RS/RA) which feeds the AppHeader badge.

---

## Switch teams

A coach belonging to multiple teams uses the team dropdown in `AppHeader`. `switchTeam(teamId)`:

1. Updates `users/{uid}/settings/teams.activeTeamId`
2. Triggers the active-team subscription to unsubscribe + re-subscribe on the new id
3. CSS variables `--team-primary` / `--team-secondary` / `--team-tertiary` snap to the new team's stored colors via the effect at `App.tsx:~3327`

Every surface that consumes those variables (header accent strip, primary buttons, badges, modals, ChatBubbles) updates without rerender plumbing.
