// Lightweight fuzzy match: case-insensitive substring score. Returns -1 if
// the query has zero characters present in the candidate; otherwise lower
// is better (matched index of the query inside the haystack).
//
// Used by the help center search ranking.
export const fuzzyScore = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  const h = (haystack || "").toLowerCase();
  const n = needle.toLowerCase();
  const idx = h.indexOf(n);
  if (idx !== -1) return idx;
  // Tokenized fallback: every needle char must appear in order somewhere.
  let cursor = 0;
  let score = 0;
  for (const ch of n) {
    const at = h.indexOf(ch, cursor);
    if (at === -1) return -1;
    score += at - cursor + 1;
    cursor = at + 1;
  }
  // Loose matches score worse than substring hits.
  return score + 1000;
};
