# Implementation Phases and Dependency Rollout

This plan follows the requested sequence:

1. Install dependency bundle (items 1–6)
2. Phase A in one PR
3. Phase B in one PR
4. Phase C in one PR
5. Phase D in one PR

## Dependency Bundle (1–6)

Planned dependencies:

1. `react-hook-form`
2. `zod`
3. `@hookform/resolvers`
4. `@tanstack/react-query`
5. `papaparse`
6. `date-fns`

Also queued for later hardening/testing:

- `@sentry/react`
- `@testing-library/user-event`
- `msw`

### Install command

```bash
npm install react-hook-form zod @hookform/resolvers @tanstack/react-query papaparse date-fns @sentry/react @testing-library/user-event msw
```

> Note: package installation is currently blocked in this environment by npm registry policy (403 Forbidden), so these installs must be run in a network context with npm access.

---

## PR 1 — Phase A (Tryouts + Invite Guardrails)

### Scope
- Convert Tryouts Portal form state/validation to `react-hook-form` + `zod`
- Keep public tryout workflow intact
- Add duplicate-signup guard logic (email + player name + tryout date)
- Normalize assistant join/invite form validation in settings

### Files
- `src/screens/TryoutsPortal.jsx`
- `src/screens/SettingsTab.jsx`
- `src/utils/helpers.ts`

### Acceptance
- Tryout submit UX unchanged, validation clearer, fewer malformed writes.
- Invite/join code entry rejects malformed payloads early.

---

## PR 2 — Phase B (Firestore Rules + Deployment Workflow)

### Scope
- Replace proposal-oriented rules comments with deploy-ready policy doc
- Add scripted deploy steps and emulator test checklist
- Add role-path validation cases: owner, assistant, anonymous tryout submitter

### Files
- `firestore.rules`
- `README.md`
- `docs/firebase-rules-rollout.md` (new)

### Acceptance
- Rules are reproducible from repo
- Deployment + rollback instructions documented

---

## PR 3 — Phase C (Architecture Refactor)

### Scope
- Keep behavior stable while reducing `App.jsx` responsibilities
- Move one coherent concern set out of `App.jsx` in this PR (team membership/invite flows)
- Add unit tests around extracted logic where possible

### Files
- `src/App.jsx`
- `src/hooks/useTeamMembership.js` (new)
- `src/hooks/useInviteFlows.js` (new)

### Acceptance
- No UX regressions in tab/routing, invites, join code flows
- `App.jsx` shrinks materially and becomes easier to reason about

---

## PR 4 — Phase D (Import/Data Reliability)

### Scope
- Move CSV parsing to `papaparse`
- Standardize date parsing/formatting via `date-fns`
- Preserve TeamSnap/GameChanger compatibility paths

### Files
- `src/utils/helpers.ts`
- `src/screens/SettingsTab.jsx`
- `src/App.jsx` (import flow call sites)

### Acceptance
- CSV edge cases improve (quoted commas/newlines)
- Date handling is deterministic and readable

---

## Sequencing Notes

- We should install dependencies before Phase A so PRs can directly adopt new libraries.
- If installation remains blocked, we can still do architectural prep PRs first and then layer library adoption once package access is restored.
