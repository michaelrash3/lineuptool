// Lightweight shared types. Kept loose because the legacy App.jsx code
// constructs these shapes ad-hoc; tightening them would cascade through
// thousands of lines. Use `Partial<...>` or extend as needed.

export type PlayerId = string;

export interface PlayerStats {
  ops?: number;
  obp?: number;
  avg?: number;
  contact?: number;
  totalPitches?: number;
  ip?: number;
  era?: number;
  ab?: number;
  h?: number;
  doubles?: number;
  triples?: number;
  hr?: number;
  rbi?: number;
  fpct?: number;
  tc?: number;
  a?: number;
  po?: number;
  ld?: number;
  fb?: number;
  gb?: number;
  hard?: number;
  qab?: number;
  babip?: number;
  [key: string]: number | undefined;
}

export interface Player {
  id: PlayerId;
  name: string;
  number?: string | number;
  dob?: string;
  stats?: PlayerStats;
  [key: string]: unknown;
}

export type SlimPlayer =
  | (Pick<Player, "id" | "name" | "number"> & { photoUrl?: string })
  | null;

// An inning maps position labels to a single player, except BENCH which is
// an array of players sitting that inning.
export interface Inning {
  BENCH?: SlimPlayer[];
  [position: string]: SlimPlayer | SlimPlayer[] | undefined;
}

export type GameStatus = "draft" | "final" | "in_progress" | string;

export interface Game {
  id: string;
  date?: string;
  time?: string;
  opponent?: string;
  status?: GameStatus;
  lineup?: Inning[];
  battingLineup?: SlimPlayer[];
  originalLineup?: Inning[];
  attendance?: Record<PlayerId, boolean>;
  [key: string]: unknown;
}

export interface Team {
  name?: string;
  primaryColor?: string;
  secondaryColor?: string;
  tertiaryColor?: string;
  players?: Player[];
  games?: Game[];
  [key: string]: unknown;
}

export interface Toast {
  push: (t: { kind: "success" | "error" | "info"; title: string; message?: string }) => void;
  dismiss?: (id: string) => void;
}

export interface CsvImportRow {
  csvName: string;
  number: string;
  stats: PlayerStats;
}

export interface CsvImportResult {
  rows: CsvImportRow[];
  error?: string;
}
