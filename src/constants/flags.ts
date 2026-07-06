// Build-time feature flags. Plain module constants (not env-driven) so they're
// tree-shaken and unit-testable, and flipping one is an explicit, reviewed diff.

// docs/eval-authz-design.md — the real fix for audit finding 3.1 (per-author
// evaluation rounds in a subcollection) rolls out in stages. This gates the
// staged read/write paths so each step can land inert before the cutover.
//
// OFF: evaluations read from and write to the legacy `evaluationEvents` array
// on the team doc (today's behavior). ON: the app reads rounds from the
// `teams/{teamId}/evalRounds` subcollection instead.
//
// KEEP THIS OFF until the per-doc write path AND the one-time data migration
// have shipped (steps 3–4). With it on before then the subcollection is empty,
// so the eval screens would read as blank. It exists now so the scoped read
// subscription (step 2) can land and be reviewed without affecting production.
export const EVAL_ROUNDS_SUBCOLLECTION = false;

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
