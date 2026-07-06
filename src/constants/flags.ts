// Build-time feature flags. Plain module constants (not env-driven) so they're
// tree-shaken and unit-testable, and flipping one is an explicit, reviewed diff.

// docs/eval-authz-design.md — the real fix for audit finding 3.1 (per-author
// evaluation rounds in a subcollection) rolls out in stages. This gates the
// staged read/write paths so each step can land inert before the cutover.
//
// OFF: evaluations read from AND write to the legacy `evaluationEvents` array on
// the team doc. ON: the subcollection at `teams/{teamId}/evalRounds` is PRIMARY
// for BOTH reads and writes — TeamProvider's role-scoped subscription owns
// teamData.evaluationEvents (handleSnap stops sourcing it from the array), and
// useEvaluationCrud gates every eval array write on !subPrimary so saves/deletes
// go per-doc to the subcollection only.
//
// NOW ON — this is the read cutover (phase 2) AND the write cutover (phase 3):
// - Reads: safe because EVAL_ROUNDS_DUAL_WRITE populated the subcollection
//   (phase 1 soak) and the lazy backfill still migrates each team's raw array on
//   load, so a not-yet-soaked team fills itself instead of reading blank.
// - Writes: per-doc via the error-propagating saveEvalRound/deleteEvalRound (a
//   failed write surfaces an error toast, unlike the best-effort mirror).
// Still reversible: flip back to false and both reads and writes return to the
// array (which the array write, still gated on !subPrimary, would resume). The
// array field is only DROPPED in phase 3b — a separate, irreversible follow-up
// once this cutover is confirmed live on real data.
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
