# Evaluations & Tryout Grades — Audit & Feature-Gap Analysis

_Audited 2026-07-05 against `main` (#504). Feature dispositions in §4 are the
auditor's **recommendations**, pending head-coach sign-off — unlike
`FINANCES-AUDIT.md`, they have not yet been reviewed with the coach._

Companion to `docs/FINANCES-AUDIT.md`, same shape: (1) what the Evaluations
area does today, (2) defects and risks found in the implementation, (3) a
coach-centered feature-gap check against comparable products (TeamSnap,
GameChanger, SportsEngine, scouting tools). Each gap carries an explicit
disposition so follow-up PRs can cite this doc.

The concurrency-clobber class that dominated the finances audit (finding 3.2)
is **already fixed here** — `saveTeamEvaluation` / `saveAssistantEvaluation` /
`deleteEvaluation` route through `updateTeamArrays` (append / mapEntries /
removeById) as of #502, and the tryout arrays followed in #503. This audit is
therefore lighter on data-loss findings and leans on server-side authorization,
legacy-data hygiene, maintainability, and test coverage.

---

## 1. Scope and architecture constraints

Like the rest of the app, evaluations live client-side on the single team doc
(`artifacts/{appId}/public/data/teams/{teamId}`):

- **`evaluationEvents`** — the roster-eval rounds array. Each round:
  `{ id, date, createdAt, coachRole: "Head"|"Assistant", evaluatorId,
evaluatorName, grades: { [playerId]: GradeMap }, label? }`. Types at
  `src/types.ts` (`EvaluationEvent`, `GradeMap`).
- **`tryoutSessions`** — date-grouped tryout grades, separate from roster
  rounds: `{ id, date, signupIds[], gradesByEvaluator: { [uid]: { coachRole,
grades: { [signupId]: GradeMap } } } }`. Legacy tryout grades also live as
  `evaluationEvents` carrying a `tryoutSignupId` and are folded in on read by
  `normalizeTryoutSessions` (`src/utils/tryouts.ts:190`).
- Two authenticated roles only (`head` / `assistant`); no player/parent users.

**Core files**

| File                                           | Role                                                      |
| ---------------------------------------------- | --------------------------------------------------------- |
| `src/screens/EvaluationTab.tsx` (~2,920 lines) | Head-coach eval dashboard + 7 inline sub-components       |
| `src/screens/AssistantEvalTab.tsx` (~350)      | Assistant grading surface (own rounds only)               |
| `src/hooks/useEvaluationCrud.ts` (~180)        | save/delete round persistence (concurrency-safe)          |
| `src/utils/evaluations.ts` (~500)              | Cadence, seeding, reminder-email gate (pure, unit-tested) |
| `src/utils/tryouts.ts` (~310)                  | Tryout-session normalize + grade blending (pure)          |
| `src/components/EvalGradeCard.tsx` (~300)      | Shared per-player grade card                              |

## 2. What the Evaluations area does today

Substantially complete for a multi-coach, cadence-driven eval workflow:

- **Head dashboard** (`EvaluationTab`) — create/edit rounds, per-player grade
  cards grouped by category tab (Hitting/Fielding/… + Kid-Pitch Pitching/
  Catching add-ons), round picker, objective stat hints per category
  (`evalStatHint`, `evaluations.ts:21`), "Save as New Round" vs a two-tap
  overwrite confirm (`EvaluationTab.tsx:1648`), and per-round delete.
- **Sub-panels** (inline in EvaluationTab): `RosterDecisionsPanel`
  (strong/fit/watch/younger buckets + pitcher-premium scoring),
  `InsightsPanel`, `RoundComparisonView` (two-round diff),
  `AssistantSubmissionsPanel` + `PlayerAssistantEvals` (head sees each
  assistant's grades inline under a player), `GradeChipRow`, `EvalTrendPage`
  (per-player trend across rounds).
- **Assistant surface** (`AssistantEvalTab`) — grade the roster; see only your
  own past rounds; Submit appends via `saveAssistantEvaluation` (arrayUnion —
  simultaneous submitters no longer clobber, #502).
- **Cadence + reminders** — `evalPromptStatus` (Feb 1 preseason + monthly
  first-of-month, ±3-day window) drives the "eval due" badge;
  `emailPromptStatus` gates automated reminder emails (7-day cool-off,
  per-assistant due flags).
- **Tryout grades** — date-grouped sessions, per-evaluator grades keyed by
  signup id; `combinedTryoutGradeForSignup` blends head + assistant averages.
- **Migrations / seeding** — `restampEvalDueDates` snaps existing rounds onto
  cadence due dates and de-dupes per (role, coach, date); the
  `EVAL_SCHEMA_VERSION` ladder (v1→v3 wipe, v2→v3 halve 1–10→1–5, v3→v4
  positive positions) runs on read (see `docs/ARCHITECTURE.md`);
  `buildPreseasonSeedRound` seeds the new season from returning players' latest
  grades + promoted tryouts' blended tryout grade.

What it deliberately does **not** do: no video/photo attachments, no
parent/player-facing eval view, no external scout sharing, no per-team custom
category sets (categories are fixed by pitching format).

## 3. Audit findings

| #   | Severity   | Area            | Finding                                                                                                                                       |
| --- | ---------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Medium** | Security        | `evaluationEvents` is member-writable server-side; assistants can read/rewrite/delete ALL rounds, not just their own                          |
| 2   | Low        | Data hygiene    | Legacy tryout grades on `evaluationEvents` are folded into sessions on every read but never migrated off — permanent dual storage + doc bloat |
| 3   | Low        | Correctness     | Compounding `Math.round` in tryout-grade blending                                                                                             |
| 4   | Low        | Maintainability | `EvaluationTab.tsx` is a ~2,920-line file with 7 inline sub-components + 8 module-level helpers                                               |
| 5   | Low        | Test coverage   | 5 of the 8 eval components are untested (RosterDecisions, Insights, RoundComparison, AssistantSubmissions, EvalTrendPage)                     |

### 3.1 `evaluationEvents` is not authorization-scoped — Medium (fixed)

The UI presents assistant visibility as "you only see your own rounds"
(`AssistantEvalTab` filters on `coachRole === "Assistant" && evaluatorId ===
uid`), and the head dashboard is gated behind `currentRole !== "assistant"`
(`EvaluationTab.tsx:1425`, `2449`). But `firestore.rules` field-gates only
`ownerId`, `members`, `finances`, and `coachRoles` — **nothing constrains
`evaluationEvents`**, so any member can read every round (including the head's
private roster decisions and other assistants' grades) and can rewrite or
delete the whole array directly through the SDK. The per-assistant visibility
is cosmetic — the same class as finances finding 3.1 before its fix.

**The catch that makes this hard:** assistants must legitimately _append_ their
own rounds (`saveAssistantEvaluation`), so a blanket `isCurrentOwner()` gate —
the finances fix — would break the assistant flow. Firestore rules cannot
cheaply express "append, or modify only array entries whose `evaluatorId`
equals `auth.uid`" over a single array. Realistic mitigations, in order of
effort: (a) accept read exposure but constrain writes to arrayUnion-append +
self-authored edits via a rules helper that diffs the array (complex, and the
granular write path already only appends/maps — a rewrite is the exposure); (b)
move assistant submissions to a per-uid subcollection the head reconciles
(schema change); (c) document the residual and rely on the trusted-coach threat
model. **Recommend (c) + a rules test that pins current behavior**, and revisit
if eval access ever widens.

**Resolved:** option (b) shipped, taken further than sketched — ALL rounds
(head and assistant) moved off the shared doc into the per-author `evalRounds`
subcollection, with reads and writes authorization-scoped in `firestore.rules`
and the legacy `evaluationEvents` array dropped and ratcheted so it can never
come back. Design + rollout: `docs/eval-authz-design.md` (status COMPLETE).

### 3.2 Legacy tryout-grade dual storage — Low (fixed)

`normalizeTryoutSessions` (`tryouts.ts:199`) folds every `evaluationEvents`
entry carrying a `tryoutSignupId` into the session map on **every read**, but
nothing ever writes those legacy events back out of `evaluationEvents`. On a
team that graded tryouts before `tryoutSessions` existed, the grades live in
two places forever, re-normalized on each render and re-counted toward the 1 MB
doc cap. **Fix direction:** a one-time migration (mirror `restampEvalDueDates`)
that moves `tryoutSignupId` events into `tryoutSessions` and drops them from
`evaluationEvents`, guarded by a schema-version bump.

**Resolved:** exactly that migration shipped as the v11 schema step —
`migrateLegacyTryoutGrades` (`src/utils/tryouts.ts`) folds `tryoutSignupId`
events into `tryoutSessions` once and drops them from the events list, guarded
by the `EVAL_SCHEMA_VERSION` bump to 11 (see the migration ladder in
`docs/ARCHITECTURE.md`; unit-tested in `src/utils/tryouts.test.ts`).

### 3.3 Compounding rounding in tryout blending — Low

`combinedTryoutGradeForSignup` (`tryouts.ts:235`) rounds each evaluator's
average, then rounds the head+assistant average again — two rounding passes over
integer 1–5/1–10 grades. Display-only and within one grade point, but a
single-pass mean over all raw grades would be truer. Bundle into any PR that
touches the blend.

**Resolved:** per-group means are now kept raw and rounded exactly once, at the
final blend, so the value no longer drifts a grade point from the true average.
The deliberate head/assistant 50/50 weighting is preserved (only the compounding
rounding was removed), and the function is now unit-tested.

### 3.4 EvaluationTab monolith — Low (maintainability)

`EvaluationTab.tsx` is ~2,920 lines: the main component (~1,190 lines) plus 7
`memo`'d sub-components (`RosterDecisionsPanel`, `InsightsPanel`,
`RoundComparisonView`, `AssistantSubmissionsPanel`, `PlayerAssistantEvals`,
`GradeChipRow`, `EvalTrendPage`) and 8 module-level helpers (`pitcherPremium`,
`avgUniversal`, `computeFlags`, `sanitizeGrades`, `formatRoundName`,
`DEFAULT_GRADES`, …). The sub-components have clean seams (each is `memo`'d with
an explicit props interface), so an extraction into `screens/evaluation/*` +
`utils/evalScoring.ts` is low-risk and unblocks focused testing. **This is the
subject of the split PR that follows this audit.**

### 3.5 Test coverage gaps — Low

`EvaluationTab.test.tsx` (5 cases) covers the dashboard shell, assistant-grade
inline display, save labeling, and the two-tap overwrite. `AssistantEvalTab` was
covered in #504. Untested: `RosterDecisionsPanel` (the bucketing + pitcher-
premium math is the highest-value untested logic), `InsightsPanel`,
`RoundComparisonView`, `AssistantSubmissionsPanel`, `EvalTrendPage`.
Extracting the scoring helpers (3.4) makes them unit-testable without rendering
the whole tab.

**Resolved:** the extracted eval sub-components now have render/behavior tests
(`screens/evaluation/panels.test.tsx`, `RosterDecisionsPanel.test.tsx`,
`EvalTrendPage.test.tsx`) covering the four roster-decision buckets + card→trend
wiring, the round-over-round Insights flags, the side-by-side comparison deltas,
assistant-submission display + two-tap delete, and the trend modal's empty /
single-eval / own-rounds-only states. The scoring math itself was unit-tested in
`utils/evalScoring.test.ts` (#507).

### 3.6 Roster-decision eval cutoffs on the wrong scale — Medium (fixed)

Found while writing the 3.5 tests: `RosterDecisionsPanel` fed
`currentEvaluationScore100` — a **0–100** score (a percentage of the grading
ceiling) — into a variable named `latestEvalAvg` and then compared it against
**1–5**-scale cutoffs (`>= 3.3`, `< 2.8`, `<= 2.5`), plus an `evalDelta` against
`0.2`/`0.5`. On the 100 scale those below-bar branches were unreachable (a real
score never dips to ≤ 2.5), so the absolute eval signal read as _always above
bar_: the "Cut / Drop a Division" age branch could never fire on eval, and the
trend was almost never "flat".

**Fixed (scale):** the value is renamed `latestEvalScore` and the cutoffs moved
onto the same 0–100 percentage scale (the ×20 equivalents, as named constants):
`EVAL_ABOVE_BAR = 66`, `EVAL_BELOW_BAR = 56`, `EVAL_FLAT_BAND = 4`,
`EVAL_STRONG_IMPROVE = 10`. The composite grading score and its display were
already correct; only these advisory bucket cutoffs were mis-scaled.

**Refined (fluid cut):** the first scale fix left the "Cut / Drop a Division"
recommendation firing on an _absolute_ score bar (`<= 50`). Cut decisions should
be **fluid** — relative to the team's own standard-deviation cut line — so the
over-matched call was moved into the relative-cut pass alongside the Cut
Candidate line: among players below that line, the ones playing up (and not on
the rise) are Cut / Drop a Division, the rest are Cut Candidates.

**Refined again (absolute floor):** a purely-relative line has a hole — a
uniformly-weak team has no spread, so it would clear _everyone_, which isn't
fair. So the cut line is now a **hybrid**: a player is flagged if they are more
than one SD below the team mean **OR** below an absolute competitive floor
(`CUT_FLOOR_SCORE = 40/100`, tunable). The relative line catches the weakest on a
strong team; the floor catches genuinely-weak players when there's no spread; a
solid, tightly-bunched team trips neither and flags nobody. Tests pin all three:
a weak playing-up kid among strong teammates is dropped (relative); a uniformly-
weak team still surfaces its weakest (floor); a uniformly-average team flags
nobody.

## 4. Coach feature-gap check

Benchmark: what an eval/scouting workflow in TeamSnap, GameChanger, or a club
scouting sheet offers that this doesn't. Feasibility judged against §1.

**Shipped:** Eval export is done — a round's grade grid downloads as CSV (#514)
for spreadsheets and as a formatted, landscape PDF grade grid for a printable
staff/board handout (lazy `jspdf`, mirroring `feeSheetPdf`).

### Recommend approving

| Feature                        | Why coaches want it                                                                   | Feasibility                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eval export (PDF/CSV)**      | Share roster decisions with a coaching staff / club board at season's end.            | Good fit. Reuse the lazy-jspdf pattern (`src/finances/feeSheetPdf.ts`) over `RosterDecisionsPanel` output + a round's grade grid. Pure client change. |
| **Per-team custom categories** | Different orgs weight different tools; today categories are fixed by pitching format. | Medium. A `evalCategoryOverrides` map on the team doc feeding `getEvalCategoriesForTeam`; touches grade seeding + migration.                          |

### Considered, recommend not planning

| Feature                                   | Note                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Parent/player-facing eval summary         | Coach evals are deliberately private; the trusted-coach model (§3.1) assumes no player reads. Declined.                             |
| Video / photo attachments on a grade      | No Cloud Storage (Spark), 1 MB doc cap. Poor fit — same call as finances receipt photos.                                            |
| External scout share link                 | Would need the anonymous-portal + `teamPublic` mirror pattern; exposes private evals. Declined.                                     |
| Weighted composite / auto-ranking overall | `RosterDecisionsPanel` buckets already approximate this; a single "overall score" invites over-trust in a subjective 1–5. Declined. |

## 5. Roadmap

Recommended order (each an independent PR); all four have since shipped:

1. **Test the eval sub-components** — cover `RosterDecisionsPanel` scoring,
   `RoundComparisonView`, `EvalTrendPage`, plus `AvailabilityTab` and
   `components/PlayerProfilePage.tsx` (the last untested surfaces). Do this **before** the
   split so the refactor is guarded. **Done** — see 3.5's resolved note;
   `AvailabilityTab.test.tsx` and `PlayerProfilePage.test.tsx` landed too.
2. **Split `EvaluationTab.tsx`** (finding 3.4) — extract the 7 sub-components
   into `src/screens/evaluation/` and the scoring helpers into
   `src/utils/evalScoring.ts`. Pure refactor, no behavior change. **Done** —
   both live at those paths.
3. **Rules test pinning `evaluationEvents` behavior** (finding 3.1) — assert
   the current member-write reality and the assistant-append path, so any
   future tightening is a deliberate, tested change. **Done, then overtaken**
   — the tightening itself shipped (the `evalRounds` subcollection, see 3.1's
   resolved note), and `firestore-tests/rules.test.ts` now pins the fixed
   behavior: the per-author scoping plus the legacy-array ratchet.
4. **Legacy tryout-grade migration** (finding 3.2) — schema-versioned one-time
   move off `evaluationEvents`. **Done** — the v11 `migrateLegacyTryoutGrades`
   step (see 3.2's resolved note).

Opportunistic (bundle when touching the code): single-pass tryout blend (3.3) —
**done**, rounds once at the final blend.

Everything in "not planning" stays out of scope until a coach reopens it.
