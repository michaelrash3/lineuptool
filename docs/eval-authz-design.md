# Design: authorization-scoped evaluations (audit finding 3.1)

_Status: **COMPLETE — Option A fully rolled out (steps 1–5).** The
`evalRounds` subcollection is the sole home for eval rounds; the legacy
`evaluationEvents` array is dropped from the team doc and the rules RATCHET it
(a straggler doc may rewrite/remove the field, but no update may recreate it
once gone and no new doc may be created with it). The `EVAL_ROUNDS_\*` flags
are removed — the flag-free code paths are permanent. Deliberately retained
as the self-limiting migration long tail: the lazy per-author backfill
(`backfillOwnEvalRounds`) and the head-only, coverage-gated drop
(`allLegacyRoundsMigrated`+`dropEvalEventsArray`) still run for any team not
opened since the cutover, and the ratchet explicitly permits both. Sequencing
at the bottom.\_

## The problem, precisely

Evaluation rounds live as the `evaluationEvents` array on the single team doc
(`teams/{teamId}`). The UI shows an assistant only their own rounds, but that
is cosmetic:

- **Reads are per-document in Firestore.** Every member must read the team doc
  (it holds roster, schedule, everything), and rules cannot hide one field from
  a reader. So any member can read every eval round — the head's private roster
  decisions and other assistants' grades included.
- **Writes to the array are unconstrained.** `firestore.rules` field-gates only
  `ownerId`, `members`, `finances`, `coachRoles`. Nothing constrains
  `evaluationEvents`, so an assistant can rewrite or delete the whole array —
  including the head's rounds — through the SDK.

(These facts are now pinned by tests in `firestore-tests/rules.test.ts`, so any
change here is a deliberate, tested one.)

## The two hard constraints

1. **Reads can't be field-scoped on a shared doc.** To protect eval _reads_
   from an assistant, the rounds must not live on a document the assistant is
   allowed to read at all. That means moving them **off the team doc**.
2. **Rules can't iterate arrays.** Firestore rules can diff two values and test
   set membership (`toSet().hasAll(...)`), but they cannot loop an array to
   check "every changed element has `evaluatorId == auth.uid`." So a
   fine-grained write guard _on the array_ is not expressible. The only
   enforceable array guards are size caps and append-only (superset) — the same
   tools the public-signup lanes use.

Together these mean: **a true fix (read + write scoping) requires moving eval
rounds off the team doc into per-author documents.**

## Options

### Option A — per-author eval subcollection (the real fix) ✅ recommended _if_ we fix it

Move rounds to `teams/{teamId}/evalRounds/{roundId}`, each doc stamped with
`evaluatorId`. Rules:

```
match /teams/{teamId}/evalRounds/{roundId} {
  allow read:   if isCurrentOwner(teamId) || resource.data.evaluatorId == request.auth.uid;
  allow create: if isMember(teamId) && request.resource.data.evaluatorId == request.auth.uid;
  allow update, delete:
                if isCurrentOwner(teamId) || resource.data.evaluatorId == request.auth.uid;
}
```

This gives **true** scoping: an assistant can create/edit/delete only their own
rounds and can only read their own; the head reads and manages everything.

**Cost — this is a real project, not a PR:**

- **Schema migration**: move every `evaluationEvents` entry to a subcollection
  doc (a fresh migration, but it can't be a pure client-read migration like
  v11 — it writes N new docs and needs care around partial failure).
- **Read path**: the active-team `onSnapshot` currently loads one doc. Evals
  now need a second subscription (a collection query, scoped per role). The
  head subscribes to all `evalRounds`; an assistant to `where evaluatorId ==
me`. `teamData.evaluationEvents` gets assembled from that stream.
- **Write path**: `useEvaluationCrud` (`saveTeamEvaluation` /
  `saveAssistantEvaluation` / `deleteEvaluation`) moves from
  `updateTeamArrays` to per-doc `setDoc`/`deleteDoc`. The concurrency-safe
  array ops (#502) no longer apply — but per-doc writes are inherently
  concurrency-safe, so that's a wash.
- **Ripple**: `RosterDecisionsPanel`, `InsightsPanel`, `EvalTrendModal`,
  `AssistantSubmissionsPanel`, the cadence helpers (`evalPromptStatus`,
  `emailPromptStatus`), `buildPreseasonSeedRound`, `restampEvalDueDates`, the
  `removePlayer` eval-grade-strip cascade, and the whole EVAL schema-migration
  ladder all read `teamData.evaluationEvents` — they keep working if the stream
  reassembles that array, but the migration ladder itself (which mutates the
  array and writes it back to the team doc) has to be rethought.
- **Architecture**: breaks the deliberate "one team doc, no subcollections"
  model the app is built on (see `docs/ARCHITECTURE.md`). The 1 MB cap stops
  bounding eval growth (a plus), but it's a real departure.

**Effort: large** (est. a multi-PR project: migration → dual subscription →
CRUD rewrite → rules + tests → cleanup).

### Option B — keep the array, add an append-only write guard for assistants (partial)

Rules: a non-head member's `evaluationEvents` write must be append-only
(`request.resource.data.evaluationEvents.toSet().hasAll(resource.data.evaluationEvents.toSet())`),
like the public signup lanes. Head/owner: unrestricted.

- **Protects**: assistants can no longer delete or rewrite the head's rounds
  (the write half of the exposure).
- **Does NOT protect reads** — an assistant still reads every round. (Constraint
  1 is unavoidable while evals stay on the team doc.)
- **Friction / breakage**:
  - The `removePlayer` cascade (#502) `mapEntries`-rewrites `evaluationEvents`
    to strip a departed player's grades — a member write that **removes** array
    content. An append-only guard blocks that for assistants. Would need a
    carve-out or to make grade-stripping head-only.
  - Assistant round _edits_ (resubmitting grades) currently replace the entry;
    under append-only they must always append a new round instead.
  - Can't stop an assistant appending a round with `coachRole: "Head"` spoofed
    (rules can't isolate the newly-added element to validate its fields).

**Effort: small–medium**, but it's a half-measure that adds friction and leaves
reads exposed. **Not recommended** — it trades real complexity for partial
protection.

### Option C — status quo: accept + pinned (current)

Keep evals on the team doc; rely on the trusted-coach threat model (only head +
assistants are ever members; there are no player/parent users). The behavior is
pinned by rules tests (#511) so it can't silently widen.

**Effort: none** (done). Appropriate while the exposure stays low-severity.

## Recommendation

The threat is **Medium** and bounded by the trusted-coach model — every member
is a coach the head personally added. Given that, **Option C (status quo,
pinned) is the right default**, and **Option A is the only real fix worth
building** — but it's a deliberate multi-PR project that breaks the single-doc
architecture, so it should be a conscious decision, not a drive-by.

**Build Option A when** any of these become true: eval access widens beyond the
head-picked coaching staff; a coach reports an assistant tampering with grades;
or the single-doc model is being revisited for another reason (evals are a
natural first subcollection). Until then, C holds.

**Do not build Option B** — the read exposure remains, and the write-guard
friction (removePlayer cascade, edit-as-append, role spoofing) costs more than
it's worth.

## If Option A is approved — suggested sequencing

1. ✅ **Done** — Rules + emulator tests for the `evalRounds` subcollection (no
   client wired yet; scoping proven). Rules in `firestore.rules`
   (`teams/{teamId}/evalRounds/{roundId}`), 14 tests in
   `firestore-tests/rules.test.ts`: head reads/manages all, assistant only their
   own, create must be self-stamped, `evaluatorId` immutable, list queries
   scoped.
2. ✅ **Done** — Dual read subscription assembling `teamData.evaluationEvents`
   from the subcollection, behind the `EVAL_ROUNDS_SUBCOLLECTION` flag (default
   off; old array still authoritative). Isolated flag-gated effect in
   `TeamProvider`; pure `buildEvalRoundsQuery` (role-scoped) + `assembleEvalRounds`
   in `src/utils/evalRounds.ts` with unit tests. Inert until the flag flips.
3. ✅ **Done** — Dual-write + lazy backfill behind the `EVAL_ROUNDS_DUAL_WRITE`
   flag (default off). `useEvaluationCrud` mirrors every save/delete to the
   subcollection best-effort (`mirrorEvalRound` / `removeEvalRoundDoc`); a
   once-per-session effect in `TeamProvider` backfills the caller's OWN legacy
   rounds (`backfillOwnEvalRounds`). Each coach self-stamps their own rounds, so
   the strict create rule is unchanged and future assistants backfill theirs on
   next load. Rollout is a two-flag cutover: flip dual-write → soak/backfill →
   flip `EVAL_ROUNDS_SUBCOLLECTION` (reads). Unit-tested; inert until flipped.
4. ✅ **Read + write cutover done** — `EVAL_ROUNDS_SUBCOLLECTION` ON.
   - _Read (phase 2):_ `handleSnap` preserves the subcollection subscription's
     `evaluationEvents` instead of overwriting from the array; the backfill now
     migrates from the raw array (`rawEvalEventsRef`) so a not-yet-soaked team
     fills on load rather than reading blank.
   - _Write (phase 3):_ `useEvaluationCrud` computes `subPrimary` (flag ON +
     db/appId/teamId present) and, when true, writes ONLY the subcollection —
     every `updateTeamArrays` eval-array write is gated on `!subPrimary`. The
     per-doc writes use the new error-propagating `saveEvalRound`/`deleteEvalRound`
     (not the best-effort mirror), so a failed save/delete surfaces an error
     toast rather than silently dropping grades. Firestore's local cache gives
     the optimistic UI the array write used to.
   - _Drop (phase 3b) ✅:_ a head-only, once-per-team effect in `TeamProvider`
     deletes the `evaluationEvents` field (`dropEvalEventsArray`) once
     `allLegacyRoundsMigrated` proves every legacy round id is present in the
     subcollection. Head-only because only the head's subscription streams
     every round (an assistant could never verify coverage); conservative
     because an empty/failed read returns false, so the drop can never fire on
     missing evidence. Rounds authored by an assistant hold the drop until that
     assistant's own backfill has run. With the drop, every remaining array
     writer was retired: the `removePlayer` grade-strip cascade strips per-doc
     (best-effort — rules scope an assistant to their own rounds; orphaned
     grades of a removed player never surface), season advance deletes rounds
     per-doc and seeds the preseason round into the subcollection (the array
     key is omitted entirely), and the schema ladder only writes
     `evaluationEvents` while the doc still carries the field.
5. ✅ **Done** — Flags removed, exposure closed.
   - `EVAL_ROUNDS_SUBCOLLECTION` / `EVAL_ROUNDS_DUAL_WRITE` deleted
     (`src/constants/flags.ts` removed); the cutover paths are now the only
     paths. `useEvaluationCrud` writes per-doc only (no `updateTeamArrays`
     dependency, no best-effort mirror branches), `usePlayerCrud`'s
     remove-player cascade never emits an eval-array op, and
     `evaluationEvents` left the `TeamArrayTypes` facade. `mirrorEvalRound` is
     module-private to the backfill; `removeEvalRoundDoc` is deleted.
   - **Rules ratchet** (`firestore.rules` base team rules): an update may
     touch `evaluationEvents` only if the doc already carries it (straggler
     schema-ladder rewrites and the head's `deleteField()` drop keep working),
     and a create may never include it — so the dropped field can only ever
     disappear from the fleet, never come back. `createTeam` writes
     `NEW_TEAM_DOC` (DEFAULT_TEAM_DATA minus the legacy key) accordingly.
   - The "pinned, not endorsed" exposure tests are replaced by the
     `evaluationEvents legacy-field ratchet` suite (rewrite-while-present
     allowed, post-drop recreation denied for assistant AND head, create-with-
     field denied, outsider denied); the scoped-access assertions live in the
     `evalRounds subcollection scoping` suite as before.
   - The backfill + drop effects in `TeamProvider` and their helpers are
     RETAINED as the self-limiting long tail for teams not opened since the
     cutover; they no-op once the doc no longer carries the array and can be
     deleted whenever confidence allows.
