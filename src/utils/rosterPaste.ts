// Turn a pasted roster — one player per line, the way coaches keep it in a
// note or a league email — into { name, number } entries. Accepts:
//   "12 Ada Lopez"   "#12 Ada Lopez"   "12. Ada Lopez"   "12 - Ada Lopez"
//   "Ada Lopez 12"   "Ada Lopez, 12"   "Ada Lopez #12"   "Ada Lopez"
// Blank lines and repeats of the same name are dropped. Pure.
export type PastedPlayer = { name: string; number: string };

const LEADING = /^#?\s*(\d{1,3})\s*[.):\-–]?\s+(.+)$/;
const TRAILING = /^(.+?)[\s,]+#?\s*(\d{1,3})$/;

export const parseRosterLines = (text: string): PastedPlayer[] => {
  const out: PastedPlayer[] = [];
  const seen = new Set<string>();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-*•]\s*/, "");
    if (!line) continue;
    let name = line;
    let number = "";
    const lead = line.match(LEADING);
    const trail = !lead && line.match(TRAILING);
    if (lead) {
      number = lead[1];
      name = lead[2];
    } else if (trail) {
      name = trail[1];
      number = trail[2];
    }
    name = name.replace(/[,;]+$/, "").trim();
    if (!name || !/[A-Za-z]/.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, number });
  }
  return out;
};
