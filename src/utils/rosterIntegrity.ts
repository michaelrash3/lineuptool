// Roster-integrity helpers: jersey-number conflicts, age-cap eligibility, and
// roster-cap counting. Pure and framework-free so the rules are unit-tested
// once and reused by the roster panel and the add-player form. "Active" mirrors
// getRosterStatus in RosterTab — a player counts unless explicitly departed.
import { calculateBaseballAge } from "./dates";

interface RosterPlayer {
  id: string;
  name?: string;
  number?: string | number;
  dob?: string | null;
  rosterStatus?: string;
}

export const isActiveRosterPlayer = (p: { rosterStatus?: string }): boolean =>
  p?.rosterStatus !== "departed";

// Normalize a jersey number to a comparable string ("" when unset).
export const normalizeJersey = (n: unknown): string =>
  n == null ? "" : String(n).trim();

// The numeric age cap encoded in a team-age tier: "10U" → 10, "8u" → 8. Null
// when the tier has no cap ("Open", unset, or unparseable).
export const parseAgeCap = (
  teamAge: string | null | undefined,
): number | null => {
  if (!teamAge) return null;
  const m = /(\d+)\s*U/i.exec(String(teamAge));
  return m ? Number(m[1]) : null;
};

export interface JerseyConflict {
  number: string;
  players: { id: string; name: string }[];
}

// Every jersey number worn by 2+ active players.
export const jerseyConflicts = (players: RosterPlayer[]): JerseyConflict[] => {
  const byNumber = new Map<string, { id: string; name: string }[]>();
  for (const p of players || []) {
    if (!isActiveRosterPlayer(p)) continue;
    const num = normalizeJersey(p.number);
    if (!num) continue;
    const list = byNumber.get(num) || [];
    list.push({ id: p.id, name: p.name || "Unnamed" });
    byNumber.set(num, list);
  }
  return [...byNumber.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([number, plist]) => ({ number, players: plist }))
    .sort((a, b) =>
      a.number.localeCompare(b.number, undefined, { numeric: true }),
    );
};

// Active players who already wear `number` (optionally excluding one id) — for
// the inline "already worn by …" warning on the add/edit forms.
export const playersWithJersey = (
  players: RosterPlayer[],
  number: unknown,
  excludeId?: string,
): { id: string; name: string }[] => {
  const target = normalizeJersey(number);
  if (!target) return [];
  return (players || [])
    .filter(
      (p) =>
        isActiveRosterPlayer(p) &&
        p.id !== excludeId &&
        normalizeJersey(p.number) === target,
    )
    .map((p) => ({ id: p.id, name: p.name || "Unnamed" }));
};

// Active players over the division age cap (too old). Empty when the division
// has no numeric cap. Age uses the same May-1 cutoff as calculateBaseballAge.
export const ageIneligiblePlayers = (
  players: RosterPlayer[],
  teamAge: string | null | undefined,
  currentSeason: string | null | undefined,
): { id: string; name: string; age: number; cap: number }[] => {
  const cap = parseAgeCap(teamAge);
  if (cap == null) return [];
  const out: { id: string; name: string; age: number; cap: number }[] = [];
  for (const p of players || []) {
    if (!isActiveRosterPlayer(p)) continue;
    const age = calculateBaseballAge(p.dob, currentSeason);
    if (age != null && age > cap) {
      out.push({ id: p.id, name: p.name || "Unnamed", age, cap });
    }
  }
  return out;
};

// The lowest unused whole jersey numbers (0-99) among active players.
export const openJerseyNumbers = (
  players: RosterPlayer[],
  count = 6,
): string[] => {
  const taken = new Set(
    (players || [])
      .filter(isActiveRosterPlayer)
      .map((p) => normalizeJersey(p.number))
      .filter(Boolean),
  );
  const out: string[] = [];
  for (let n = 0; n <= 99 && out.length < count; n++) {
    if (!taken.has(String(n))) out.push(String(n));
  }
  return out;
};

// Count of active (non-departed) players — the number a roster cap applies to.
export const activeRosterCount = (players: RosterPlayer[]): number =>
  (players || []).filter(isActiveRosterPlayer).length;
