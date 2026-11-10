import {
  buildPortalSchedule,
  PORTAL_SCHEDULE_MAX_DAYS,
} from "./portalSchedule";

describe("buildPortalSchedule", () => {
  const today = "2026-05-10";

  it("publishes only upcoming game and practice DATES — nothing else", () => {
    const out = buildPortalSchedule(
      {
        games: [
          {
            id: "g1",
            date: "2026-05-16",
            opponent: "Sharks",
            location: "Field 3",
            startUtc: "2026-05-16T17:00:00Z",
          },
          { id: "g0", date: "2026-05-01", opponent: "Past" },
        ],
        practices: [{ id: "p1", date: "2026-05-12", location: "Park" }],
      },
      today,
    );
    expect(out).toEqual({
      gameDays: ["2026-05-16"],
      practiceDays: ["2026-05-12"],
    });
    // Belt and braces: no opponent, place or time leaks into the payload.
    expect(JSON.stringify(out)).not.toMatch(/Sharks|Field|Park|17:00/);
  });

  it("includes today, dedupes doubleheaders and sorts", () => {
    const out = buildPortalSchedule(
      {
        games: [
          { date: "2026-05-20" },
          { date: "2026-05-10" },
          { date: "2026-05-20" },
        ],
      },
      today,
    );
    expect(out.gameDays).toEqual(["2026-05-10", "2026-05-20"]);
  });

  it("leaves off postponed games, cancelled practices and bad dates", () => {
    const out = buildPortalSchedule(
      {
        games: [
          { date: "2026-05-14", status: "postponed" },
          { date: "TBD" },
          { date: "" },
        ],
        practices: [{ date: "2026-05-13", status: "cancelled" }],
      },
      today,
    );
    expect(out).toEqual({ gameDays: [], practiceDays: [] });
  });

  it("stops about six months out and caps the list", () => {
    const far = buildPortalSchedule(
      { games: [{ date: "2027-03-01" }, { date: "2026-11-01" }] },
      today,
    );
    expect(far.gameDays).toEqual(["2026-11-01"]);

    const many = Array.from({ length: 300 }, (_, i) => {
      const d = new Date(2026, 4, 10 + (i % 180));
      return {
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      };
    });
    expect(
      buildPortalSchedule({ practices: many }, today).practiceDays.length,
    ).toBeLessThanOrEqual(PORTAL_SCHEDULE_MAX_DAYS);
  });

  it("tolerates a team with no schedule", () => {
    expect(buildPortalSchedule(null, today)).toEqual({
      gameDays: [],
      practiceDays: [],
    });
  });
});
