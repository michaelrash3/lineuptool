// Short id for in-document objects (players, games, eval rounds, ledger lines,
// etc.). These are NOT secrets — Firestore rules enforce access server-side — so
// a Math.random suffix is fine; this centralizes the ~30 copies of
// `Math.random().toString(36).slice(2, 10)` and standardizes the suffix length.
//
// Lives in its own leaf module (no imports) so utils/finances.ts — which
// utils/helpers.ts re-exports via `export *` — can use it without an import
// cycle. For anything that gates access (join codes, share links), use
// randomCode() in utils/helpers.ts instead.
export const genId = (prefix?: string): string => {
  const suffix = Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}-${suffix}` : suffix;
};
