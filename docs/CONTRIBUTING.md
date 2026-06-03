# Contributing

Quick reference for working on Lineup Tool. Pair this with `ARCHITECTURE.md` for the bigger picture.

## Branches and PRs

- Branch from `main`. Name branches by what they do (`fix-popup-loop`, `welcome-chooser-modal`); the `claude/<adjective>-<noun>-<id>` pattern is reserved for agent-driven work.
- Open PRs as **draft** until they're green, then mark ready for review.
- One reviewable concern per PR when you can — large multi-concern PRs are accepted only when the changes are tightly coupled (e.g., a Firestore rule change that requires a client code change in the same commit to stay deployable).
- PR description should answer: what changed, why, and how it was tested. Reference issues or earlier PRs that motivated the work.

## Local development

```bash
npm install
npm start              # Vite dev server at http://localhost:3000
npm run test:watch     # Vitest watch mode
npm test               # one-shot test run (vitest run)
npm run build          # production Vite build into ./dist
```

CI runs the typecheck (`tsc --noEmit`), the test suite (`npm test`), and the production build (`npm run build`) on every push. Run them locally before pushing.

There's no formatter pinned, so match the surrounding style of whatever file you touch.

## Testing

- Pure logic in `src/lineupEngine.ts` and `src/utils/helpers.ts` has unit tests. New pure helpers should land with tests in `*.test.js` next to the source.
- React Testing Library is wired up (`@testing-library/react` + `jest-dom`, auto-loaded via `src/setupTests.ts`). Component and hook tests live in `*.test.tsx` next to the source. Use `renderWithProviders` from `src/test-utils.tsx` to render anything that consumes the Toast/Team/UI contexts; mock Firebase with `jest.mock` (see `src/hooks/useInviteFlows.test.tsx`). Screenshot before/after for visual changes the DOM assertions don't cover.
- When you touch a Firestore-rule-sensitive path, also walk the validation matrix in `docs/firebase-rules-rollout.md` against the emulator before merging.

## When to update which doc

| Touched | Update |
|---|---|
| New screen, new context value, new top-level routing | `docs/ARCHITECTURE.md` |
| Changed a user-facing flow (sign-in, join, tryouts, eval, in-game) | `docs/USER-FLOWS.md` |
| Changed `firestore.rules` | `docs/firebase-rules-rollout.md` (validation matrix + rollback note) |
| Added a deploy step, env var, or build flag | `README.md` quickstart |
| Bumped `EVAL_SCHEMA_VERSION` or any other schema version | `docs/ARCHITECTURE.md` migration ladder + a one-release fallback in code |
| Visual change to a primitive (Button, Card, Modal, etc.) | The corresponding preview HTML under `docs/design/coachs-card/preview/` |

## Rules rollout

`firestore.rules` is deployed from the repo, not the Firebase Console. The full procedure is in `docs/firebase-rules-rollout.md`. The short version:

1. Edit `firestore.rules` in the repo.
2. Test against the emulator (`firebase emulators:start --only firestore`).
3. Walk the validation matrix.
4. Deploy with `firebase deploy --only firestore:rules` (or paste into the Firebase Console if the CLI isn't available).
5. Smoke-test owner, assistant, and tryouts portal in production.

Never edit rules in the Console without mirroring the change back into the repo — your change will be silently reverted the next time someone deploys from source.

## Code conventions

- **No emojis in code or comments** unless the file is intentionally about emoji rendering (e.g., empty-state glyphs sanctioned in `docs/design/coachs-card/ICONOGRAPHY.md`).
- **Comments explain *why*, not *what*.** Identifiers should already tell the reader what. Add a comment for a hidden constraint, a surprise, or a workaround for a known bug.
- **Don't over-abstract.** Three similar lines is better than a premature helper. Helpers earn their keep when there are 5+ call sites or the logic is non-obvious.
- **Reuse before inventing.** The primitives in `src/components/shared.jsx` (Button, Chip, GlassCard, Eyebrow, StatTile, PlayerAvatar) and the semantic type classes in `src/styles.css` (`.t-h1`, `.t-eyebrow`, `.t-body`, etc.) cover the vast majority of UI cases.
- **Persistence goes through `persistTeam` / `updateTeam`** — never call `setDoc` from a screen.
- **CSS color tokens** (`var(--team-primary)`, `var(--slate-700)`, etc.) over Tailwind defaults whenever the value belongs to the design system. Hardcoded hex codes belong only in `src/styles.css`.

## Hooks and side effects

The app uses `useEffect` heavily. Two rules that have bitten us:

1. **List every dependency the linter wants.** The exhaustive-deps rule catches real bugs. If you need a stable callback, wrap it in `useCallback`; if you need a fire-once effect, factor the body into a `useRef` instead of dropping deps.
2. **`onSnapshot` subscriptions must clean up.** Always return `unsub()` from the effect. The active-team subscription in `App.jsx` also handles a one-shot retry for `permission-denied` — copy that pattern if you add another rule-sensitive subscription.

## What not to do

- Don't add npm dependencies without checking that the registry policy in CI allows them. Several historically-blocked installs are tracked in `docs/unfinished-work-single-pr-plan.md`.
- Don't commit secrets, build artifacts (`/build`), or `.env` files. The `.gitignore` covers the common cases but verify before staging.
- Don't push to `main`. Open a PR.
- Don't reformat large unrelated regions in a feature PR — it makes the diff unreviewable. Save formatting passes for their own PR.
