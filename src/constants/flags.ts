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
