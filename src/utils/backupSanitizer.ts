// Sanitizes a parsed backup JSON before it replaces the team doc. The restore
// path writes the file's contents verbatim, which made it the one real-world
// vector for undated/malformed finance entries (audit finding 3.4) — every
// in-app entry constructor defaults to today, but a hand-edited or older
// backup can carry anything.

import { genId } from "./id";
import { isValidIsoDate } from "./dates";

// A restore replaces team CONTENT, never access control: restoring a stale
// ownerId/members/coachRoles set could lock the current coaches out or trip
// the rules-layer ownership guards mid-write. joinCode rides along because a
// stale code would desync from the /teamInvites lookup doc.
const ACL_KEYS = ["ownerId", "members", "coachRoles", "joinCode"] as const;

// Finance arrays whose entries carry a date + amount. sponsorships' date is
// optional, so only a PRESENT-but-invalid one is repaired there.
const FINANCE_ENTRY_KEYS = [
  "payments",
  "incomes",
  "expenses",
  "sponsorships",
] as const;

export const sanitizeBackup = (
  data: Record<string, unknown>,
  todayIso: string,
): { data: Record<string, unknown>; repairedFinanceDates: number } => {
  const out: Record<string, unknown> = { ...data };
  for (const k of ACL_KEYS) delete out[k];

  let repaired = 0;
  const finances = out.finances;
  if (finances && typeof finances === "object" && !Array.isArray(finances)) {
    const fin: Record<string, unknown> = {
      ...(finances as Record<string, unknown>),
    };
    for (const key of FINANCE_ENTRY_KEYS) {
      const arr = fin[key];
      if (!Array.isArray(arr)) continue;
      fin[key] = arr.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const e = { ...(entry as Record<string, unknown>) };
        if (!e.id) e.id = genId("fin");
        const amount = Number(e.amount);
        e.amount = Number.isFinite(amount) ? amount : 0;
        if (key !== "sponsorships" || e.date != null) {
          // Datetime strings trim to their date; anything still invalid
          // becomes today and is counted. Money records are never dropped —
          // totals, charts, and ledger ordering just agree again.
          const coerced = String(e.date ?? "").slice(0, 10);
          if (isValidIsoDate(coerced)) {
            if (coerced !== e.date) e.date = coerced;
          } else {
            e.date = todayIso;
            repaired += 1;
          }
        }
        return e;
      });
    }
    out.finances = fin;
  }
  return { data: out, repairedFinanceDates: repaired };
};
