// Mock data for the UI kit — populated to look like a real 10U team.
window.MOCK_TEAM = {
  name: "Cedar Park Riverhawks",
  logoUrl: "../../assets/baseball-mark.svg",
  primaryColor: "#2563eb",
  secondaryColor: "#f8fafc",
  tertiaryColor: "#ffffff",
  teamAge: "10U",
  currentSeason: "Spring 2026",
  leagueRuleSet: "USSSA",
  pitchingFormat: "Kid Pitch",
  record: { wins: 9, losses: 5, ties: 0, runsScored: 112, runsAllowed: 78 },
};

window.MOCK_PLAYERS = [
  { id: "p1", name: "Miguel Rodriguez", number: "14", primaryPosition: "SS", bats: "R", throws: "R", present: true,
    stats: { avg: 0.412, obp: 0.488, ops: 1.124, h: 21, doubles: 5, triples: 1, hr: 3, rbi: 17, fpct: 0.962, po: 11, a: 14, tc: 26, ip: 0, era: 0 } },
  { id: "p2", name: "Ava Park", number: "7", primaryPosition: "CF", bats: "L", throws: "R", present: true,
    stats: { avg: 0.389, obp: 0.452, ops: 0.998, h: 18, doubles: 4, triples: 2, hr: 1, rbi: 11, fpct: 0.951, po: 18, a: 1, tc: 20 } },
  { id: "p3", name: "Jaylen Brooks", number: "22", primaryPosition: "P", bats: "R", throws: "R", present: true,
    stats: { avg: 0.341, obp: 0.412, ops: 0.901, h: 15, doubles: 3, triples: 0, hr: 2, rbi: 14, fpct: 0.917, po: 4, a: 8, tc: 13, ip: 18.2, era: 2.11 } },
  { id: "p4", name: "Sam Okafor", number: "3", primaryPosition: "1B", bats: "R", throws: "R", present: true,
    stats: { avg: 0.318, obp: 0.380, ops: 0.852, h: 14, doubles: 4, triples: 0, hr: 1, rbi: 13, fpct: 0.978, po: 32, a: 2, tc: 35 } },
  { id: "p5", name: "Riley Chen", number: "9", primaryPosition: "C", bats: "R", throws: "R", present: true,
    stats: { avg: 0.295, obp: 0.361, ops: 0.802, h: 13, doubles: 2, triples: 1, hr: 0, rbi: 9, fpct: 0.989, po: 47, a: 5, tc: 53 } },
  { id: "p6", name: "Diego Alvarez", number: "11", primaryPosition: "2B", bats: "L", throws: "R", present: true,
    stats: { avg: 0.272, obp: 0.348, ops: 0.755, h: 11, doubles: 2, triples: 0, hr: 0, rbi: 6, fpct: 0.946, po: 10, a: 14, tc: 26 } },
  { id: "p7", name: "Owen Hart", number: "18", primaryPosition: "3B", bats: "R", throws: "R", present: false,
    stats: { avg: 0.241, obp: 0.310, ops: 0.681, h: 9, doubles: 1, triples: 0, hr: 0, rbi: 5, fpct: 0.890, po: 5, a: 11, tc: 18 } },
  { id: "p8", name: "Noah Kim", number: "5", primaryPosition: "LF", bats: "R", throws: "R", present: true,
    stats: { avg: 0.233, obp: 0.301, ops: 0.652, h: 8, doubles: 1, triples: 0, hr: 0, rbi: 4, fpct: 0.920, po: 9, a: 0, tc: 10 } },
  { id: "p9", name: "Lucas Mendez", number: "27", primaryPosition: "RF", bats: "R", throws: "R", present: true,
    stats: { avg: 0.221, obp: 0.295, ops: 0.620, h: 7, doubles: 0, triples: 0, hr: 1, rbi: 5, fpct: 0.875, po: 5, a: 1, tc: 7 } },
  { id: "p10", name: "Caleb Nguyen", number: "32", primaryPosition: "P", bats: "R", throws: "L", present: true,
    stats: { avg: 0.205, obp: 0.280, ops: 0.590, h: 6, doubles: 1, triples: 0, hr: 0, rbi: 3, fpct: 0.890, po: 2, a: 6, tc: 9, ip: 14.0, era: 3.21 } },
  { id: "p11", name: "Theo Walker", number: "0", primaryPosition: "CF", bats: "R", throws: "R", present: true,
    stats: { avg: 0.188, obp: 0.255, ops: 0.520, h: 5, doubles: 0, triples: 0, hr: 0, rbi: 2, fpct: 0.857, po: 10, a: 0, tc: 12 } },
  { id: "p12", name: "Jonah Reyes", number: "44", primaryPosition: "P", bats: "L", throws: "L", present: true,
    stats: { avg: 0.172, obp: 0.230, ops: 0.480, h: 4, doubles: 0, triples: 0, hr: 0, rbi: 1, fpct: 0.833, po: 1, a: 4, tc: 6, ip: 10.1, era: 4.05 } },
];

window.MOCK_GAMES = [
  { id: "g1", opponent: "Raptors", date: "2026-05-11", status: "scheduled", lineup: true, isBigGame: true,
    leagueRuleSet: "USSSA", pitchingFormat: "Kid Pitch" },
  { id: "g2", opponent: "Wildcats", date: "2026-05-14", status: "scheduled", lineup: false },
  { id: "g3", opponent: "Stingers", date: "2026-05-04", status: "final", lineup: true, teamScore: 9, opponentScore: 6 },
];

window.MOCK_COACHES = [
  { id: "c1", name: "Mike Rash", role: "Head Coach" },
  { id: "c2", name: "Dana Whitlock", role: "Assistant Coach" },
  { id: "c3", name: "Anthony Park", role: "Assistant Coach" },
];
