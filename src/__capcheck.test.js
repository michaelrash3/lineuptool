import { describe, it } from "vitest";
import { generateLineup } from "./lineupEngine.ts";

const ALL = ["P","C","1B","2B","3B","SS","LF","CF","RF"];
const mk = (id) => ({ id, name: id, number: "", primaryPosition: "", restrictions: [], comfortablePositions: ALL });

describe("cap probe", () => {
  it("lock carryover catcher cap", () => {
    const players = Array.from({length:11},(_,i)=>mk("p"+i));
    let violations = 0; let built = 0;
    for (const lock of ["2","3","full"]) for (const consec of [true,false]) for (let seed = 0; seed < 20; seed++) {
      const res = generateLineup({
        activePlayers: players, allPlayers: players, games: [], evaluationEvents: [],
        currentGame: { id: "g", date: "2026-05-01" },
        totalInnings: 6, leagueRuleSet: "USSSA", teamAge: "8U",
        defenseSize: "9", positionLock: lock, battingSize: "roster",
        seed, catcherMaxInnings: "2", catcherConsecutive: consec,
      });
      if (res.error) continue; built++;
      const counts = {};
      res.lineup.forEach(inn => { const c = inn.C; if (c) counts[c.id]=(counts[c.id]||0)+1; });
      for (const [id,n] of Object.entries(counts)) {
        if (n > 2) { violations++; process.stdout.write(`VIOLATION lock=${lock} consec=${consec} seed=${seed}: ${id}=${n}\n`); }
      }
    }
    console.log("TOTAL VIOLATIONS:", violations);process.stdout.write("MARKER built="+built+" violations="+violations+"\n");
  });
});
