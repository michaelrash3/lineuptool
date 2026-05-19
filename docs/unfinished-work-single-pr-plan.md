# Unfinished Work Consolidation Plan (Single PR)

This document consolidates all remaining items from the recent implementation chain into one PR.

## Current Execution Status (May 18, 2026)

- ✅ Settings tab menu-style category shell has been implemented.
- ✅ Phase C core extraction includes membership/invite/join-code logic plus import/export flows moved from `App.jsx` into hooks.
- ⚠️ Dependency adoption remains blocked in this environment by npm registry `403 Forbidden` for the planned bundle.
- ✅ Phase D reliability fallback is implemented without external packages: CSV parsing now supports quoted commas/newlines and date-only imports avoid timezone day shifts.
- ✅ Final Settings cleanup continues through extracted advanced panels while preserving existing menu IA.

## Objective

Ship all unfinished work from Phases C and D, deferred dependency adoption, and a full Settings tab cleanup/navigation overhaul in a single coordinated PR.

## In-Scope Work

### 1) Dependency adoption (deferred)

Add and wire the planned libraries:

- `react-hook-form`
- `zod`
- `@hookform/resolvers`
- `@tanstack/react-query`
- `papaparse`
- `date-fns`

Also include deferred hardening/test dependencies if environment permits:

- `@sentry/react`
- `@testing-library/user-event`
- `msw`

Primary files:

- `package.json`
- `package-lock.json`

### 2) Phase C completion (App architecture extraction)

Extract remaining responsibility from `App.jsx` into dedicated hooks/modules:

- `src/hooks/useTeamMembership.js` (new)
- `src/hooks/useInviteFlows.js` (new)
- Refactor `src/App.jsx` to consume these hooks and remove duplicated inline business logic.

### 3) Phase D completion (import/data reliability)

Improve import/date reliability by:

- Migrating CSV parsing to `papaparse`.
- Standardizing date parsing/formatting with `date-fns`.
- Preserving TeamSnap/GameChanger compatibility logic.

Primary files:

- `src/utils/helpers.ts`
- `src/screens/SettingsTab.jsx`
- `src/App.jsx` (import flow call sites)

### 4) Settings tab overhaul (cleanup + menu-style navigation)

Perform a product-level cleanup of Settings to remove non-essential items and reorganize the tab into a menu-style layout.

Scope:

- Audit all current Settings sections and remove stale, duplicate, or low-value controls.
- Group retained controls into clear menu categories (for example: Team, Tryouts, Staff, Imports/Exports, Advanced).
- Replace long-scroll mixed blocks with a menu/panel pattern so users select a category first, then see focused controls.
- Keep privileged/destructive actions clearly separated and visually distinct.
- Preserve existing permissions and business rules while changing layout/IA.

Primary files:

- `src/screens/SettingsTab.jsx`
- Supporting style/layout files used by Settings
- `src/App.jsx` only where routing or tab wiring must be adjusted

### 5) Validation and regression checks

Required checks in the same PR:

- Tryouts portal duplicate-signup guard still works.
- Invite/join-code flows behave identically for valid users.
- Rules-compatible writes remain unchanged (owner/member/assistant/public portal pathways).
- CSV imports (quoted commas/newlines) parse correctly.
- Dates are deterministic across import and display paths.
- Settings actions remain reachable after the menu-style refactor.
- Removed Settings items do not break existing coach workflows.

## Delivery Checklist (Single PR)

- [x] Attempt install + lock dependency bundle (blocked by npm registry 403 in this environment).
- [x] Complete Phase C extraction (`useTeamMembership`, `useInviteFlows`) and continue extraction with `useImportExportFlows`.
- [x] Complete Phase D parser/date reliability fallback while package adoption is blocked.
- [x] Overhaul Settings tab into menu-style IA and extract advanced panel pieces.
- [x] Add or update tests for import/date parsing.
- [ ] Add UI/regression checks for updated Settings navigation and actions.
- [ ] Manual smoke-test matrix for owner, assistant, tryouts portal, and join-by-code.
- [ ] Update docs with any rollout caveats.

## Risk Notes

Bundling all unfinished work into one PR increases blast radius and review size. To mitigate:

- Keep commits logically separated by subsection (deps, Phase C, Phase D, Settings IA, tests/docs).
- Preserve existing permissions and route semantics.
- Add explicit rollback notes for parser/date migration boundaries.
- Include before/after screenshots for Settings to speed review.

## Definition of Done

Single PR is complete when:

1. Planned dependencies are present and used where intended.
2. `App.jsx` responsibilities are materially reduced for membership/invite domains.
3. CSV/date reliability improvements are merged with compatibility preserved.
4. Settings is cleaned up and converted to a menu-style experience without permission regressions.
5. Tests and smoke checks pass and are documented in PR notes.
