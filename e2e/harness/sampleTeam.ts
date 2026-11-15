// A mid-season sample team for the browser check: a full roster with stats, a
// played schedule with real engine-built lineups, upcoming games (one today),
// practices, two tournaments, two eval rounds, one pitcher out injured and one
// away for a game. Dates are relative to today so "Today" / "This Week"
// surfaces are populated whenever the check runs; everything else is fixed by
// a seeded generator, so two runs on the same day build the same team.
//
// Made-up names only. Nothing here is real team data.
import { DEFAULT_TEAM_DATA } from "../../src/constants/ui";
import { generateTournamentLineup } from "../../src/lineupEngine";

const isoDay = (offsetDays: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const instantAt = (offsetDays: number, hour: number, minute = 0): string => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const NAMES = [
  "Mason Alvarez",
  "Liam Brooks",
  "Noah Castellano",
  // Long on purpose: names like this are what overflow a phone layout.
  "Ethan Delacroix-Montgomery",
  "Jack Ellis",
  "Owen Fitzgerald",
  "Caleb Garcia",
  "Henry Hoang",
  "Wyatt Ito",
  "Leo Jankowski",
  "Miles Kowalczyk",
  "Theo Lindqvist",
];
const NUMBERS = [7, 12, 3, 22, 9, 15, 2, 44, 11, 5, 18, 27];
const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const EVAL_CATEGORIES = [
  "contact",
  "approach",
  "power",
  "glove",
  "armStrength",
  "armAccuracy",
  "speed",
  "baserunning",
  "baseballIQ",
  "coachability",
  "composure",
  "pitchVelo",
];
const OPPONENTS = [
  "Eastside Bandits",
  "Harbor City Hawks",
  "Maple Grove Mudcats",
  "Northfield Knights",
  "Lakeshore Thunder",
  "Pine Ridge Pirates",
  "Cedar Valley Storm",
  "Riverside Renegades",
  "South County Sluggers",
  "Twin Rivers Titans",
  "Ironwood Outlaws",
];

export const buildSampleTeam = () => {
  // Small seeded generator — Math.random would make every run a new team.
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const between = (lo: number, hi: number) => lo + random() * (hi - lo);
  const now = new Date().toISOString();

  const players = NAMES.map((name, i) => {
    const ab = Math.round(between(18, 46));
    const h = Math.round(ab * between(0.18, 0.46));
    const bb = Math.round(between(2, 12));
    const pa = ab + bb + 1;
    const doubles = Math.round(h * between(0.05, 0.3));
    const obp = (h + bb) / pa;
    const slg = (h + doubles) / ab;
    // Five spots each: a primary, a secondary and three more. Narrower than
    // that and the engine can't always fill nine positions for six innings
    // (catcher is opt-in, so only the kids with "C" here ever catch).
    const positions = [0, 3, 5, 7, 8].map(
      (step) => POSITIONS[(i + step) % POSITIONS.length],
    );
    const pitches = positions.includes("P");
    return {
      id: `p${i + 1}`,
      name,
      number: String(NUMBERS[i]),
      // A 10U roster: nine- and ten-year-olds.
      dob: `${i < 6 ? 2016 : 2017}-${String((i % 6) + 6).padStart(2, "0")}-1${i % 9}`,
      bats: i % 4 === 0 ? "L" : "R",
      throws: i % 5 === 0 ? "L" : "R",
      primaryPosition: positions[0],
      secondaryPosition: positions[1],
      comfortablePositions: positions,
      isCatcher: positions.includes("C"),
      returning: true,
      // One pitcher out injured (Leo, back in nine days) and one player
      // limited — the states the roster, Home and the pitch planner react to.
      health:
        name === "Leo Jankowski"
          ? {
              status: "out",
              note: "Sprained ankle",
              expectedReturn: isoDay(9),
              updatedAt: now,
            }
          : name === "Jack Ellis"
            ? {
                status: "limited",
                note: "Sore shoulder — no pitching",
                updatedAt: now,
              }
            : undefined,
      // Caleb (a pitcher) is away for the game two days out.
      absences: name === "Caleb Garcia" ? [isoDay(2)] : [],
      stats: {
        pa,
        ab,
        h,
        bb,
        hbp: 1,
        doubles,
        triples: 0,
        hr: i === 2 ? 2 : 0,
        rbi: Math.round(between(2, 16)),
        sb: Math.round(between(0, 9)),
        k: Math.round(between(3, 14)),
        avg: h / ab,
        obp,
        slg,
        ops: obp + slg,
        qab: Math.round(between(30, 60)),
        fpct: between(0.78, 0.98),
        tc: Math.round(between(10, 40)),
        ...(pitches
          ? {
              pIp: Number(between(4, 22).toFixed(1)),
              pEra: Number(between(1.5, 7.5).toFixed(2)),
              pWhip: Number(between(1, 2.4).toFixed(2)),
              pStrikePct: Math.round(between(48, 66)),
              pBf: Math.round(between(20, 90)),
              totalPitches: Math.round(between(80, 400)),
              pTopMph: Math.round(between(42, 56)),
            }
          : {}),
      },
      pitching: pitches
        ? {
            log: [
              { date: isoDay(-3 - i), pitches: 20 + i * 4 },
              { date: isoDay(-10 - i), pitches: 30 + i * 3 },
            ],
            recentPitches: 20 + i * 4,
            lastPitchDate: isoDay(-3 - i),
          }
        : { log: [], lastPitchDate: null },
    };
  });

  const gradesFor = (bias: number) =>
    Object.fromEntries(
      players.map((p, i) => [
        p.id,
        Object.fromEntries(
          EVAL_CATEGORIES.map((category, j) => [
            category,
            Math.max(
              1,
              Math.min(
                10,
                Math.round(4 + ((i * 7 + j * 3) % 5) + bias + random()),
              ),
            ),
          ]),
        ),
      ]),
    );
  const evaluationEvents = [
    {
      id: "eval-preseason",
      date: isoDay(-60),
      createdAt: Date.now() - 60 * 86_400_000,
      coachRole: "Head",
      evaluatorId: "coach-sample",
      label: "Preseason",
      grades: gradesFor(0),
    },
    {
      id: "eval-midseason",
      date: isoDay(-20),
      createdAt: Date.now() - 20 * 86_400_000,
      coachRole: "Head",
      evaluatorId: "coach-sample",
      label: "Midseason",
      grades: gradesFor(1),
    },
  ];

  const rules = {
    leagueRuleSet: "USSSA",
    teamAge: "10U",
    defenseSize: "9",
    positionLock: "1",
    battingSize: "roster",
    totalInnings: 6,
    pitchingFormat: "Kid Pitch",
  };

  // Seven played games, a week apart then a two-game tournament weekend. Each
  // lineup comes from the real engine, fed the games before it.
  const games: any[] = [];
  const scores = [
    [8, 4],
    [3, 7],
    [11, 2],
    [5, 5],
    [6, 3],
    [9, 10],
    [2, 1],
  ];
  [-42, -35, -28, -21, -14, -7, -6].forEach((offset, i) => {
    const game: any = {
      id: `g${i + 1}`,
      date: isoDay(offset),
      startUtc: instantAt(offset, 18),
      opponent: OPPONENTS[i],
      status: "final",
      isHome: i % 2 === 0,
      location: i % 2 === 0 ? "Rivertown Park — Field 3" : "Away",
      teamScore: scores[i][0],
      opponentScore: scores[i][1],
      gameType: i >= 5 ? "tournament" : "league",
      attendance: Object.fromEntries(players.map((p) => [p.id, true])),
    };
    // The engine the app itself uses for a USSSA team (useLineupActions).
    const built: any = generateTournamentLineup({
      activePlayers: players,
      allPlayers: players,
      games,
      evaluationEvents,
      currentGame: game,
      firstInningOverridesById: {},
      competitive: true,
      seed: 40 + i,
      isBigGame: false,
      ...rules,
    } as any);
    // The check's screens depend on these lineups existing; if the engine
    // ever refuses this roster, say so instead of quietly rendering a
    // schedule of "lineup needed" games.
    if (built.error || !built.lineup)
      throw new Error(
        `Sample team: the engine built no lineup for ${game.id}: ${built.error} ${(built.details || []).join("; ")}`,
      );
    game.lineup = built.lineup;
    game.battingLineup = built.battingLineup || null;
    games.push(game);
  });

  // Five upcoming: tonight, a two-game tournament this weekend, and two later.
  [0, 2, 3, 9, 16].forEach((offset, i) => {
    games.push({
      id: `u${i + 1}`,
      date: isoDay(offset),
      startUtc: i === 0 ? instantAt(offset, 19, 30) : instantAt(offset, 10),
      opponent: OPPONENTS[7 + (i % 4)],
      status: "draft",
      isHome: i % 2 === 1,
      location:
        i % 2 === 1
          ? "Rivertown Park — Field 1"
          : "Legion Complex, 1200 W Industrial Pkwy",
      lineup: null,
      battingLineup: null,
      gameType: i === 1 || i === 2 ? "tournament" : "league",
      attendance: {},
    });
  });

  const practices = [-9, -4, 1, 5].map((offset, i) => ({
    id: `pr${i + 1}`,
    date: isoDay(offset),
    startUtc: instantAt(offset, 17, 30),
    location: "Rivertown Park — Cages",
    environment: i % 2 === 1 ? "indoor" : "outdoor",
    attendance:
      offset < 0
        ? Object.fromEntries(
            players.map((p, j) => [
              p.id,
              (j + i) % 6 === 0 ? "absent" : "present",
            ]),
          )
        : {},
    drills: [],
    planNotes: offset < 0 ? "Bunt defense and first-and-third." : "",
    source: "manual",
    status: "scheduled",
  }));

  return {
    ...DEFAULT_TEAM_DATA,
    id: "team-sample",
    name: "Rivertown Rockets 10U",
    teamAge: "10U",
    defenseSize: "9",
    currentSeason: "Fall 2026",
    ownerId: "coach-sample",
    coaches: [
      {
        uid: "coach-sample",
        name: "Coach Sample",
        role: "head",
        email: "coach@example.com",
      },
      {
        uid: "coach-assistant",
        name: "Assistant Pat",
        role: "assistant",
        email: "pat@example.com",
      },
    ],
    players,
    games,
    practices,
    tournaments: [
      {
        id: "tn1",
        name: "Fall Classic",
        gameIds: ["g6", "g7"],
        createdAt: isoDay(-8),
      },
      {
        id: "tn2",
        name: "Turkey Shootout",
        gameIds: ["u2", "u3"],
        createdAt: isoDay(-1),
      },
    ],
    evaluationEvents,
    tryoutSessions: [],
    finances: {},
  };
};
