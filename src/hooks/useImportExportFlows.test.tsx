import { renderHook, waitFor } from "@testing-library/react";
import { csvEscape, useImportExportFlows } from "./useImportExportFlows";
import { applyTeamOps, makeToast } from "../test-utils";

describe("csvEscape", () => {
  it("passes through plain values untouched", () => {
    expect(csvEscape("Rivera")).toBe("Rivera");
    expect(csvEscape(12)).toBe("12");
  });

  it("renders null/undefined as an empty field", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });

  it("quotes values containing commas, quotes, or newlines", () => {
    expect(csvEscape("Smith, Jr.")).toBe('"Smith, Jr."');
    expect(csvEscape("line one\nline two")).toBe('"line one\nline two"');
    // Embedded quotes are doubled per RFC 4180.
    expect(csvEscape('He said "go"')).toBe('"He said ""go"""');
  });
});

const setupScheduleImport = () => {
  const updateTeamArrays = jest.fn();
  const toast = makeToast();
  const teamData = {
    games: [],
    leagueRuleSet: "USSSA",
    pitchingFormat: "Kid Pitch",
    defenseSize: 9,
    battingSize: 10,
    positionLock: false,
  };
  const { result } = renderHook(() =>
    useImportExportFlows({
      teamDataRef: { current: teamData },
      updateTeamArrays,
      activeTeamId: "t1",
      toast,
    } as any),
  );
  const run = (csv: string) => {
    const file = new File([csv], "schedule.csv", { type: "text/csv" });
    result.current.uploadScheduleCsv({
      target: { files: [file], value: "" },
    } as any);
  };
  return { run, teamData, updateTeamArrays, toast };
};

describe("uploadScheduleCsv", () => {
  it("imports valid rows (as ONE bulk append) and surfaces rows with an unrecognized date", async () => {
    const { run, teamData, updateTeamArrays, toast } = setupScheduleImport();
    run(
      "Date,Opponent\n" +
        "2026-05-01,Rays\n" +
        "05/08/2026,Cubs\n" +
        "someday,Sharks\n" + // unparseable date -> skipped + surfaced
        ",NoDateRow\n" + // blank date -> ignored silently
        "\n", // trailing blank line -> ignored
    );
    await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
    const op = updateTeamArrays.mock.calls[0][0];
    expect(op).toMatchObject({ op: "append", key: "games" });
    const games = applyTeamOps(teamData, op).games;
    expect(games).toHaveLength(2);
    expect(games.map((g: any) => g.opponent)).toEqual(["Rays", "Cubs"]);
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "success",
        title: "Imported 2 games",
        message: "Skipped 1 row with an unrecognized date.",
      }),
    );
  });

  it("ingests a Location column when present", async () => {
    const { run, teamData, updateTeamArrays } = setupScheduleImport();
    run(
      "Date,Opponent,Location\n" +
        "2026-05-01,Rays,Miller Field\n" +
        "2026-05-08,Cubs,\n", // blank location -> empty string
    );
    await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
    const games = applyTeamOps(
      teamData,
      updateTeamArrays.mock.calls[0][0],
    ).games;
    expect(games.map((g: any) => g.location)).toEqual(["Miller Field", ""]);
  });

  it("omits the skipped message when every dated row parses", async () => {
    const { run, updateTeamArrays, toast } = setupScheduleImport();
    run("Date,Opponent\n2026-05-01,Rays\n");
    await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Imported 1 game", message: undefined }),
    );
  });

  it("errors when no date column is present", async () => {
    const { run, updateTeamArrays, toast } = setupScheduleImport();
    run("Team,Opponent\nUs,Them\n");
    await waitFor(() =>
      expect(toast.push).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          title: "Schedule import failed",
        }),
      ),
    );
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });
});

describe("uploadGameStatsCsv (per-game import)", () => {
  const setup = (gameOverrides: any = {}, teamOverrides: any = {}) => {
    const updateTeamArrays = jest.fn();
    const toast = makeToast();
    const teamData = {
      games: [
        { id: "g1", date: "2026-05-01", opponent: "Hawks", ...gameOverrides },
      ],
      players: [
        { id: "p1", name: "Sammy Sosa", stats: {} },
        { id: "p2", name: "Frank Thomas", stats: {} },
      ],
      pitchingFormat: "Kid Pitch",
      ...teamOverrides,
    };
    const { result } = renderHook(() =>
      useImportExportFlows({
        teamDataRef: { current: teamData },
        updateTeamArrays,
        activeTeamId: "t1",
        toast,
      } as any),
    );
    const run = (csv: string) => {
      const file = new File([csv], "game.csv", { type: "text/csv" });
      result.current.uploadGameStatsCsv("g1", {
        target: { files: [file], value: "" },
      } as any);
    };
    // The write is one atomic list: games + players mapEntries.
    const applied = () =>
      applyTeamOps(teamData, updateTeamArrays.mock.calls[0][0]);
    return { run, updateTeamArrays, toast, applied };
  };

  const csv =
    "First,Last,AB,H,AVG,HR,RBI,IP,ERA\n" +
    "Sammy,Sosa,3,2,.667,1,3,2,4.50\n" +
    "Nobody,Known,4,1,.250,0,0,0,0\n";

  it("attaches matched lines to the game and re-derives season stats", async () => {
    const { run, updateTeamArrays, applied } = setup();
    run(csv);
    await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
    const ops = updateTeamArrays.mock.calls[0][0];
    expect(ops.map((u: any) => [u.op, u.key])).toEqual([
      ["mapEntries", "games"],
      ["mapEntries", "players"],
    ]);
    const patch = applied();
    const g1 = patch.games.find((g: any) => g.id === "g1");
    expect(g1.playerStats.p1).toMatchObject({ ab: 3, h: 2, hr: 1, ip: 2 });
    expect(g1.statsImportedAt).toBeTruthy();
    // Season stats re-derived from the game line (sum of one line).
    const p1 = patch.players.find((p: any) => p.id === "p1");
    expect(p1.stats).toMatchObject({ ab: 3, h: 2, hr: 1 });
    expect(p1.stats.avg).toBeCloseTo(2 / 3);
    // Unmatched CSV row is ignored; p2 untouched.
    expect(g1.playerStats.p2).toBeUndefined();
  });

  it("strips pitching for a Machine Pitch game", async () => {
    const { run, updateTeamArrays, applied } = setup({
      pitchingFormat: "Machine Pitch",
    });
    run(csv);
    await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
    const g1 = applied().games.find((g: any) => g.id === "g1");
    expect(g1.playerStats.p1.ab).toBe(3);
    expect(g1.playerStats.p1.ip).toBeUndefined();
    expect(g1.playerStats.p1.era).toBeUndefined();
  });

  it("logs pitching (#P) and catching (fielding C) outings from the box score", async () => {
    const { run, updateTeamArrays, applied } = setup();
    // Two-row GameChanger header: #P in Pitching, C (innings caught) + Total in
    // Fielding. Sammy pitched 42; Frank caught 6.
    const gc =
      "Batting,,,,,Pitching,,Fielding,,\n" +
      "First,Last,AB,H,AVG,#P,IP,C,Total,FPCT\n" +
      "Sammy,Sosa,3,2,.667,42,2,0,7,.950\n" +
      "Frank,Thomas,2,1,.500,0,0,6,6,1.000\n";
    run(gc);
    await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
    const patch = applied();
    const p1 = patch.players.find((p: any) => p.id === "p1");
    const p2 = patch.players.find((p: any) => p.id === "p2");
    // Pitcher's arm-care log gets the outing, keyed by game id.
    expect(p1.pitching.log).toEqual([
      { date: "2026-05-01", pitches: 42, gameId: "g1" },
    ]);
    // Catcher's log gets the caught innings from the fielding "C" column.
    expect(p2.catching.log).toEqual([
      { date: "2026-05-01", innings: 6, gameId: "g1" },
    ]);
    // Per-game fielding innings are stored on the game line.
    const g1 = patch.games.find((g: any) => g.id === "g1");
    expect(g1.playerStats.p2).toMatchObject({ fInnC: 6, fInnTotal: 6 });
  });

  it("errors clearly when no CSV row matches the roster", async () => {
    const { run, updateTeamArrays, toast } = setup();
    run("First,Last,AB,H\nNo,Match,3,1\n");
    await waitFor(() =>
      expect(toast.push).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "error" }),
      ),
    );
    expect(updateTeamArrays).not.toHaveBeenCalled();
  });
});

describe("importBackup (restore)", () => {
  const setup = () => {
    const updateTeam = jest.fn();
    const toast = makeToast();
    const confirm = jest.fn().mockResolvedValue(true);
    const teamData = { players: [], games: [] };
    const { result } = renderHook(() =>
      useImportExportFlows({
        teamDataRef: { current: teamData },
        updateTeam,
        activeTeamId: "t1",
        toast,
        confirm,
      } as any),
    );
    const run = (text: string) => {
      const file = new File([text], "backup.json", {
        type: "application/json",
      });
      result.current.importBackup({
        target: { files: [file], value: "" },
      } as any);
    };
    return { run, updateTeam, toast };
  };

  it("restores a file that looks like a LineupTool backup", async () => {
    const { run, updateTeam, toast } = setup();
    run(JSON.stringify({ players: [{ id: "p1", name: "Sam" }], games: [] }));
    await waitFor(() => expect(updateTeam).toHaveBeenCalled());
    expect(updateTeam.mock.calls[0][0].players).toHaveLength(1);
    expect(updateTeam.mock.calls[0][1]).toEqual({ allowEmptyPlayers: true });
    expect(toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success", title: "Backup restored" }),
    );
  });

  it("rejects a valid-JSON file that isn't a backup, without writing", async () => {
    const { run, updateTeam, toast } = setup();
    run(JSON.stringify({ notATeam: true }));
    await waitFor(() =>
      expect(toast.push).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          title: "Could not parse backup",
        }),
      ),
    );
    expect(updateTeam).not.toHaveBeenCalled();
  });
});
