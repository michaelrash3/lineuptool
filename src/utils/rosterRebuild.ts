// Roster reconstruction after a players-array loss. The team doc holds the
// roster as ONE array field — if that field is ever emptied (the incident this
// module was written for), the season's OTHER data still references every kid
// by player id: game attendance/lineups/stat lines, practice attendance, the
// depth chart's per-position orderings, eval grades, and the applied
// availability / player-info submissions (which also carry names, DOBs, and
// contacts). This module mines those surviving references back into Player
// records so history — which is keyed by player id and was never lost —
// reattaches to the rebuilt roster.
//
// Pure and Firebase-free: callers pass the team bag they already hold and
// write the result through the provider's guarded paths.

import type {
  AvailabilitySubmission,
  Game,
  Inning,
  Player,
  PlayerInfoSubmission,
  Practice,
  SlimPlayer,
  Team,
} from "../types";

// Everything the rebuild mines. All optional — mine whatever survives.
export interface RosterEvidenceSource {
  games?: Game[];
  practices?: Practice[];
  depthChart?: Record<string, string[]>;
  availabilitySubmissions?: AvailabilitySubmission[];
  playerInfoSubmissions?: PlayerInfoSubmission[];
  // Assembled eval rounds (the evalRounds subcollection union) — grades are
  // keyed by player id.
  evaluationEvents?: Array<{ grades?: Record<string, unknown> }>;
}

export interface RecoveredPlayerEvidence {
  id: string;
  name?: string;
  number?: string;
  dob?: string;
  // Every distinct place this id was seen, for the recovery preview.
  sources: string[];
  // Depth-chart positions this id appears under, in board order. Shown to the
  // coach as a hint; NOT written as comfortablePositions (see rebuild below).
  depthPositions: string[];
  // Union of parent-submitted unavailable dates, for absences.
  absenceDates: string[];
  // Sizing/logistics off the latest applied Player Info submission.
  info?: PlayerInfoSubmission;
  // Latest applied availability submission stamp.
  availabilitySubmittedAt?: string;
}

// The full position set, matching the schema-v4 migration's permissive
// default. Rebuilt players get the permissive set for the FIELD positions so
// the lineup engine treats nobody as ineligible — but Pitcher and Catcher are
// opt-in specialties throughout the app (they gate eval categories, arm care,
// and the catcher policies), so a rebuilt player only gets "P"/"C" when the
// surviving depth chart actually lists them there. Granting them to everyone
// would flag the whole roster as pitcher-catchers and put every kid on the
// Pitching/Catching eval tabs.
const ALL_POSITIONS = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "LCF",
  "CF",
  "RCF",
  "RF",
];
const SPECIALTY_POSITIONS = new Set(["P", "C"]);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

// Descending ISO-instant comparator — latest submission first.
const bySubmittedAtDesc = (
  a: { submittedAt?: string },
  b: { submittedAt?: string },
): number =>
  String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""));

export const collectRosterEvidence = (
  source: RosterEvidenceSource,
): Map<string, RecoveredPlayerEvidence> => {
  const evidence = new Map<string, RecoveredPlayerEvidence>();
  const entry = (id: unknown): RecoveredPlayerEvidence | null => {
    if (!isNonEmptyString(id)) return null;
    let e = evidence.get(id);
    if (!e) {
      e = { id, sources: [], depthPositions: [], absenceDates: [] };
      evidence.set(id, e);
    }
    return e;
  };
  const seen = (id: unknown, label: string): RecoveredPlayerEvidence | null => {
    const e = entry(id);
    if (e && !e.sources.includes(label)) e.sources.push(label);
    return e;
  };

  const mineSlim = (p: SlimPlayer, label: string) => {
    if (!p || !isNonEmptyString(p.id)) return;
    const e = seen(p.id, label);
    if (!e) return;
    // Lineups carry the authoritative display identity — never overwrite a
    // name already mined from another lineup slot with a blank.
    if (!e.name && isNonEmptyString(p.name)) e.name = p.name;
    if (!e.number && p.number != null && String(p.number).length > 0)
      e.number = String(p.number);
  };

  for (const g of source.games || []) {
    if (!g) continue;
    for (const inning of [
      ...(Array.isArray(g.lineup) ? g.lineup : []),
      ...(Array.isArray(g.originalLineup) ? g.originalLineup : []),
    ] as Inning[]) {
      if (!inning) continue;
      for (const slot of Object.values(inning)) {
        if (Array.isArray(slot))
          slot.forEach((p) => mineSlim(p, "game lineups"));
        else if (slot) mineSlim(slot, "game lineups");
      }
    }
    for (const p of Array.isArray(g.battingLineup) ? g.battingLineup : [])
      mineSlim(p, "batting orders");
    for (const id of Object.keys(g.attendance || {}))
      seen(id, "game attendance");
    for (const id of Object.keys(g.playerStats || {}))
      seen(id, "game stat lines");
  }

  for (const p of source.practices || []) {
    for (const id of Object.keys(p?.attendance || {}))
      seen(id, "practice attendance");
  }

  for (const [position, ids] of Object.entries(source.depthChart || {})) {
    for (const id of Array.isArray(ids) ? ids : []) {
      const e = seen(id, "depth chart");
      if (e && !e.depthPositions.includes(position))
        e.depthPositions.push(position);
    }
  }

  for (const ev of source.evaluationEvents || []) {
    for (const id of Object.keys(ev?.grades || {})) seen(id, "eval rounds");
  }

  // Applied submissions link a player id to a NAME + DOB (and, for player
  // info, sizing + contacts). Latest submission wins per player.
  const availability = [...(source.availabilitySubmissions || [])]
    .filter((s) => s && isNonEmptyString(s.appliedToPlayerId))
    .sort(bySubmittedAtDesc);
  for (const sub of availability) {
    const e = seen(sub.appliedToPlayerId, "availability submissions");
    if (!e) continue;
    const name = `${sub.firstName || ""} ${sub.lastName || ""}`.trim();
    if (!e.name && name) e.name = name;
    if (!e.dob && isNonEmptyString(sub.dob)) e.dob = sub.dob;
    if (!e.availabilitySubmittedAt && isNonEmptyString(sub.submittedAt))
      e.availabilitySubmittedAt = sub.submittedAt;
    const dates = [
      ...(Array.isArray(sub.dates) ? sub.dates : []),
      ...(Array.isArray(sub.blocks) ? sub.blocks.map((b) => b?.date) : []),
    ];
    for (const d of dates)
      if (isNonEmptyString(d) && !e.absenceDates.includes(d))
        e.absenceDates.push(d);
  }

  const info = [...(source.playerInfoSubmissions || [])]
    .filter((s) => s && isNonEmptyString(s.appliedToPlayerId))
    .sort(bySubmittedAtDesc);
  for (const sub of info) {
    const e = seen(sub.appliedToPlayerId, "player info submissions");
    if (!e) continue;
    const name = `${sub.firstName || ""} ${sub.lastName || ""}`.trim();
    if (!e.name && name) e.name = name;
    if (!e.dob && isNonEmptyString(sub.dob)) e.dob = sub.dob;
    if (!e.info) e.info = sub;
  }

  return evidence;
};

// Build storable Player records from the evidence. Original ids are the whole
// point: attendance, stat lines, eval grades, and depth-chart slots all key on
// them, so the season re-attaches the moment these land.
export const rebuildPlayersFromEvidence = (
  evidence: Map<string, RecoveredPlayerEvidence>,
): Player[] => {
  const entries = [...evidence.values()];
  // Named players first (alphabetical), unnamed last in stable id order, and
  // number placeholder names AFTER sorting so "Recovered player N" counts up
  // in display order.
  entries.sort((a, b) => {
    if (!!a.name !== !!b.name) return a.name ? -1 : 1;
    if (a.name && b.name) return a.name.localeCompare(b.name);
    return a.id.localeCompare(b.id);
  });
  let unnamed = 0;
  return entries.map((e) => {
    const player: Player = {
      id: e.id,
      name: e.name || `Recovered player ${++unnamed}`,
      // Permissive field-position default; P/C only on depth-chart evidence
      // (see ALL_POSITIONS above).
      comfortablePositions: ALL_POSITIONS.filter(
        (pos) =>
          !SPECIALTY_POSITIONS.has(pos) || e.depthPositions.includes(pos),
      ),
    };
    if (e.number) player.number = e.number;
    if (e.dob) player.dob = e.dob;
    if (e.absenceDates.length > 0) player.absences = [...e.absenceDates].sort();
    if (e.availabilitySubmittedAt)
      player.availabilitySubmittedAt = e.availabilitySubmittedAt;
    const sub = e.info;
    if (sub) {
      // Same field mapping applyPlayerInfoToPlayer uses — blanks skipped so a
      // sparse submission never writes empty strings.
      const put = (key: keyof Player & string, value: unknown) => {
        const v = String(value ?? "").trim();
        if (v) (player as Record<string, unknown>)[key] = v;
      };
      if (!player.number) put("number", sub.number);
      put("hatSize", sub.hatSize);
      put("shirtSize", sub.shirtSize);
      put("pantsSize", sub.pantsSize);
      put("height", sub.height);
      put("weight", sub.weight);
      put("school", sub.school);
      put("grade", sub.grade);
      put("parentName", sub.parentName);
      put("email", sub.email);
      put("phone", sub.phone);
      put("parent2Name", sub.parent2Name || sub.emergencyName);
      put("parent2Phone", sub.parent2Phone || sub.emergencyPhone);
      put("parent2Email", sub.parent2Email);
      if (isNonEmptyString(sub.submittedAt))
        player.playerInfoSubmittedAt = sub.submittedAt;
    }
    return player;
  });
};

export interface RosterRebuildPlan {
  players: Player[];
  evidence: Map<string, RecoveredPlayerEvidence>;
  namedCount: number;
}

// One-call convenience for the recovery UI: mine the team bag, build the
// players. Returns an empty plan when there is nothing to recover.
export const planRosterRebuild = (
  team: Partial<Team> | null | undefined,
): RosterRebuildPlan => {
  const evidence = collectRosterEvidence({
    games: team?.games,
    practices: team?.practices,
    depthChart: team?.depthChart,
    availabilitySubmissions: team?.availabilitySubmissions,
    playerInfoSubmissions: team?.playerInfoSubmissions,
    evaluationEvents: team?.evaluationEvents,
  });
  const players = rebuildPlayersFromEvidence(evidence);
  return {
    players,
    evidence,
    namedCount: players.filter((p) => !p.name.startsWith("Recovered player "))
      .length,
  };
};
