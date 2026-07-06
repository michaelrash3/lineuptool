// Build-time feature flags. Plain module constants (not env-driven) so they're
// tree-shaken and unit-testable, and flipping one is an explicit, reviewed diff.

// docs/eval-authz-design.md — the real fix for audit finding 3.1 (per-author
// evaluation rounds in a subcollection) rolls out in stages. This gates the
// staged read/write paths so each step can land inert before the cutover.
//
// OFF: evaluations read from the legacy `evaluationEvents` array on the team
// doc. ON: the app reads rounds from the `teams/{teamId}/evalRounds`
// subcollection instead (TeamProvider's role-scoped subscription owns
// teamData.evaluationEvents; handleSnap stops sourcing it from the array).
//
// NOW ON (rollout phase 2 — "read cutover"): reads come from the subcollection.
// Safe because EVAL_ROUNDS_DUAL_WRITE has been populating it (phase 1 soak +
// ongoing dual-write) and the lazy backfill still migrates each team's raw
// array on load, so a not-yet-soaked team fills itself instead of reading
// blank. Still reversible: flip back to false and reads return to the array
// (which dual-write keeps current). The array is only DROPPED in phase 3, after
// this is confirmed on real data.
export const EVAL_ROUNDS_SUBCOLLECTION = true;

// The WRITE half of the same rollout (step 3). ON: every eval save/delete is
// ALSO mirrored to the evalRounds subcollection (best-effort, by the round's
// own author), and each coach lazily backfills their OWN existing rounds on
// load. The legacy array stays authoritative — this only POPULATES the
// subcollection so it's complete and in-sync before reads flip
// (EVAL_ROUNDS_SUBCOLLECTION). Enabling this first, letting it soak, then
// enabling reads is the safe two-flag cutover.
//
// NOW ON (rollout phase 1 — "soak"): the subcollection is being populated in
// production, but reads still come from the legacy array (EVAL_ROUNDS_
// SUBCOLLECTION is still off), so the UX is unchanged and this is fully
// reversible — flip back to false and the array is still authoritative. Reads
// flip only after the subcollection is confirmed complete on real data.
export const EVAL_ROUNDS_DUAL_WRITE = true;
