// Stat metadata + display formatting shared by the Season Stats tab, the
// PlayerProfileModal, and the stat-trend charts. The chart components
// themselves live in ./statTrendViz (lazy-loaded) so this module stays free
// of the recharts dependency for the eager modals graph.
export const PROFILE_SECTIONS = [
  { id: "general", label: "General" },
  { id: "report", label: "Report" },
  { id: "stats", label: "Stats" },
  { id: "innings", label: "Innings" },
  { id: "contact", label: "Contact" },
];

// Convert a chosen file into a 256×256 JPEG data URL ready to persist
// inline on the player record. Photos no longer round-trip through Cloud
// Storage (Spark plan compatibility) — they're stored alongside the rest
// of the player document in Firestore. Removal is just clearing the
// photoUrl field; nothing external needs to be deleted.
export const STATS_TAB_KEYS = [
  "ops",
  "obp",
  "avg",
  "contact",
  "totalPitches",
  "ab",
  "h",
  "doubles",
  "triples",
  "hr",
  "rbi",
  "fpct",
  "tc",
  "a",
  "po",
  "ip",
  "era",
  "ld",
  "fb",
  "gb",
  "hard",
  "qab",
  "babip",
];

// Per-stat metadata used by the Season Stats tab and the year-over-year chart.
// `kind`: "decimal" (e.g. .345 avg), "int" (e.g. 12 hr), "percent" (e.g. 45%),
//          "ip" (innings pitched, shows as 12.1 for 12 1/3).
// `label`: shown on cards/chart axes
// `category`: groups stats; pitching is hidden for non-Kid Pitch seasons
// `higherIsBetter`: used for the trend arrow direction
export const STAT_META: Record<string, any> = {
  ops: {
    label: "OPS",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  obp: {
    label: "OBP",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  avg: {
    label: "AVG",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  contact: {
    label: "Contact%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  ab: { label: "AB", kind: "int", category: "hitting", higherIsBetter: true },
  h: { label: "H", kind: "int", category: "hitting", higherIsBetter: true },
  doubles: {
    label: "2B",
    kind: "int",
    category: "hitting",
    higherIsBetter: true,
  },
  triples: {
    label: "3B",
    kind: "int",
    category: "hitting",
    higherIsBetter: true,
  },
  hr: { label: "HR", kind: "int", category: "hitting", higherIsBetter: true },
  rbi: { label: "RBI", kind: "int", category: "hitting", higherIsBetter: true },
  sb: { label: "SB", kind: "int", category: "hitting", higherIsBetter: true },
  k: { label: "K", kind: "int", category: "hitting", higherIsBetter: false },
  ld: {
    label: "LD%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  fb: {
    label: "FB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  gb: {
    label: "GB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: false,
  },
  hard: {
    label: "Hard%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  qab: {
    label: "QAB%",
    kind: "percent",
    category: "hitting",
    higherIsBetter: true,
  },
  babip: {
    label: "BABIP",
    kind: "decimal",
    category: "hitting",
    higherIsBetter: true,
  },
  fpct: {
    label: "FPCT",
    kind: "decimal",
    category: "fielding",
    higherIsBetter: true,
  },
  tc: { label: "TC", kind: "int", category: "fielding", higherIsBetter: true },
  a: { label: "A", kind: "int", category: "fielding", higherIsBetter: true },
  po: { label: "PO", kind: "int", category: "fielding", higherIsBetter: true },
  ip: { label: "IP", kind: "ip", category: "pitching", higherIsBetter: true },
  era: {
    label: "ERA",
    kind: "decimal",
    category: "pitching",
    higherIsBetter: false,
  },
  totalPitches: {
    label: "TP",
    kind: "int",
    category: "pitching",
    higherIsBetter: false,
  },
};

// Format a stat value for display. Returns "—" for missing/zero values when
// appropriate (so a kid with 0 HR shows as 0, but a kid with no AVG shows as —).

export const formatStatValue = (key: any, value: any) => {
  if (value === null || value === undefined) return "—";
  const meta = STAT_META[key];
  if (!meta) return String(value);
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  switch (meta.kind) {
    case "decimal":
      // Convention: drop leading 0 for sub-1 stats (.345 not 0.345)
      if (n > 0 && n < 1) return n.toFixed(3).replace(/^0/, "");
      return n.toFixed(3);
    case "percent":
      // Stored as decimal (0.45 = 45%) or already as percent (45)?
      // We treat values <= 1 as decimals to convert; otherwise display as-is.
      const pct = n <= 1 ? n * 100 : n;
      return `${pct.toFixed(1)}%`;
    case "int":
      return Math.round(n).toString();
    case "ip": {
      // IP convention: integer.thirds (e.g. 5.2 = 5 and 2/3)
      return n.toFixed(1);
    }
    default:
      return String(n);
  }
};
