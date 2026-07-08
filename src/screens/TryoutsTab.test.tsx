import React from "react";
import { screen } from "@testing-library/react";
import { TryoutsTab, computeRosterProjection } from "./TryoutsTab";
import { renderWithProviders } from "../test-utils";

const grade = (n: number, suggestedPositions: string[] = []) => ({
  approach: n,
  speed: n,
  baserunning: n,
  baseballIQ: n,
  coachability: n,
  composure: n,
  suggestedPositions,
});

const session = (signupId: string, grades: any, date = "2026-07-01") => [
  {
    id: `tryout-${date}`,
    date,
    updatedAt: 2,
    gradesByEvaluator: {
      head: {
        coachRole: "Head",
        evaluatorId: "head",
        grades: { [signupId]: grades },
      },
    },
  },
];

const baseTeam = (overrides: any = {}) => ({
  rosterCap: 3,
  teamAge: "10U",
  currentSeason: "2026",
  pitchingFormat: "Kid Pitch",
  games: [],
  players: [
    {
      id: "yes-1",
      name: "Locked Returner",
      returning: true,
      comfortablePositions: ["P"],
    },
  ],
  ...overrides,
});

describe("TryoutsTab", () => {
  it("renders the tryouts dashboard for an empty signup list", () => {
    renderWithProviders(<TryoutsTab />, {
      team: {
        team: {
          tryoutSignups: [],
          evaluationEvents: [],
          defenseSize: 9,
          pitchingFormat: "Kid Pitch",
        },
        user: { uid: "u1" },
        currentRole: "head",
        updateTryoutSignup: jest.fn(),
        deleteTryoutSignup: jest.fn(),
        acceptTryout: jest.fn(),
        saveTryoutEvaluation: jest.fn(),
      },
    });
    expect(screen.getByText("Tryouts")).toBeInTheDocument();
  });

  it("surfaces the in-tab tryout setup controls for the head (moved out of Settings)", () => {
    renderWithProviders(<TryoutsTab />, {
      team: {
        team: {
          tryoutSignups: [],
          evaluationEvents: [],
          defenseSize: 9,
          pitchingFormat: "Kid Pitch",
          tryoutDates: [],
        },
        user: { uid: "u1" },
        currentRole: "head",
        updateTryoutSignup: jest.fn(),
        deleteTryoutSignup: jest.fn(),
        acceptTryout: jest.fn(),
        saveTryoutEvaluation: jest.fn(),
      },
    });
    expect(screen.getByText(/Tryout setup — dates, link/)).toBeInTheDocument();
  });

  it("coach-adds a walk-up with an auto-assigned tryout number", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const appendTryoutSignup = jest.fn();
    renderWithProviders(<TryoutsTab />, {
      team: {
        team: {
          // #1 taken on this date → the walk-up gets #2.
          tryoutSignups: [
            {
              id: "s1",
              firstName: "A",
              lastName: "B",
              submittedAt: "2026-07-01T00:00:00.000Z",
              tryoutDate: "2026-08-01",
              tryoutNumber: "1",
            },
          ],
          evaluationEvents: [],
          defenseSize: 9,
          pitchingFormat: "Kid Pitch",
          tryoutDates: ["2026-08-01"],
        },
        user: { uid: "u1" },
        currentRole: "head",
        appendTryoutSignup,
        updateTryoutSignup: jest.fn(),
        deleteTryoutSignup: jest.fn(),
        acceptTryout: jest.fn(),
        saveTryoutEvaluation: jest.fn(),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /\+ Add Player/i }));
    fireEvent.change(screen.getByLabelText("First name"), {
      target: { value: "Walk" },
    });
    fireEvent.change(screen.getByLabelText("Last name"), {
      target: { value: "Up" },
    });
    fireEvent.change(screen.getByLabelText("Tryout date"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Add Player$/ }));
    expect(appendTryoutSignup).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Walk",
        lastName: "Up",
        tryoutDate: "2026-08-01",
        tryoutNumber: "2",
        present: true,
      }),
    );
  });

  it("records a showcase measurement from the expanded card (shared, definitive)", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const saveTryoutMeasurements = jest.fn();
    renderWithProviders(<TryoutsTab />, {
      team: {
        team: {
          tryoutSignups: [
            {
              id: "s1",
              firstName: "Ava",
              lastName: "Best",
              submittedAt: "2026-07-01T00:00:00.000Z",
              tryoutDate: "2026-08-01",
            },
          ],
          evaluationEvents: [],
          defenseSize: 9,
          pitchingFormat: "Kid Pitch",
          teamAge: "10U",
        },
        user: { uid: "u1" },
        currentRole: "assistant", // any coach records measured data
        updateTryoutSignup: jest.fn(),
        deleteTryoutSignup: jest.fn(),
        acceptTryout: jest.fn(),
        saveTryoutEvaluation: jest.fn(),
        saveTryoutMeasurements,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    // 10U basepath context shows on the showcase header.
    expect(screen.getByText(/over 65 ft basepaths/)).toBeInTheDocument();
    const exit = screen.getByLabelText("Ava Best Exit velo");
    fireEvent.change(exit, { target: { value: "57" } });
    fireEvent.blur(exit);
    expect(saveTryoutMeasurements).toHaveBeenCalledWith("s1", {
      exitVeloMph: 57,
    });
  });

  it("hides the setup controls from assistants", () => {
    renderWithProviders(<TryoutsTab />, {
      team: {
        team: {
          tryoutSignups: [],
          evaluationEvents: [],
          defenseSize: 9,
          pitchingFormat: "Kid Pitch",
        },
        user: { uid: "u1" },
        currentRole: "assistant",
        updateTryoutSignup: jest.fn(),
        deleteTryoutSignup: jest.fn(),
        acceptTryout: jest.fn(),
        saveTryoutEvaluation: jest.fn(),
      },
    });
    expect(
      screen.queryByText(/Tryout setup — dates, link/),
    ).not.toBeInTheDocument();
  });
});

describe("computeRosterProjection", () => {
  it("ranks a tryout above an unknown current player for a final spot", () => {
    const team = baseTeam({
      rosterCap: 2,
      players: [
        {
          id: "yes-1",
          name: "Locked Returner",
          returning: true,
          comfortablePositions: ["P"],
        },
        { id: "unk-1", name: "Bubble Returner", comfortablePositions: ["2B"] },
      ],
    });
    const projection = computeRosterProjection(
      team,
      session("try-1", grade(5, ["C"])),
      [
        {
          id: "try-1",
          firstName: "Top",
          lastName: "Tryout",
          status: "tryout",
          tryoutDate: "2026-07-01",
        },
      ],
      [{ coachRole: "Head", grades: { "unk-1": grade(2) }, createdAt: 1 }],
    );
    expect(projection.recommended).toHaveLength(1);
    expect(projection.recommended[0]).toMatchObject({
      kind: "tryout",
      name: "Top Tryout",
    });
    expect(projection.nextBest[0]).toMatchObject({
      kind: "unknown",
      name: "Bubble Returner",
    });
  });

  it("ranks an unknown current player above a tryout when their fit score is higher", () => {
    const team = baseTeam({
      rosterCap: 2,
      players: [
        {
          id: "yes-1",
          name: "Locked Returner",
          returning: true,
          comfortablePositions: ["P"],
        },
        { id: "unk-1", name: "Strong Returner", comfortablePositions: ["C"] },
      ],
    });
    const projection = computeRosterProjection(
      team,
      session("try-1", grade(2, ["2B"])),
      [
        {
          id: "try-1",
          firstName: "Lower",
          lastName: "Tryout",
          status: "tryout",
          tryoutDate: "2026-07-01",
        },
      ],
      [{ coachRole: "Head", grades: { "unk-1": grade(5) }, createdAt: 1 }],
    );
    expect(projection.recommended[0]).toMatchObject({
      kind: "unknown",
      name: "Strong Returner",
    });
  });

  it("counts accepted tryouts as locked slots and excludes confirmed returners from competing", () => {
    const team = baseTeam({ rosterCap: 2 });
    const projection = computeRosterProjection(
      team,
      session("try-1", grade(5, ["C"])),
      [
        {
          id: "accepted-1",
          firstName: "Accepted",
          lastName: "Player",
          status: "accepted",
          tryoutDate: "2026-07-01",
        },
        {
          id: "try-1",
          firstName: "Open",
          lastName: "Candidate",
          status: "tryout",
          tryoutDate: "2026-07-01",
        },
      ],
      [],
    );
    expect(projection.acceptedCount).toBe(1);
    expect(projection.slotsRemaining).toBe(0);
    expect(projection.recommended).toHaveLength(0);
    expect(projection.nextBest[0]).toMatchObject({
      kind: "tryout",
      name: "Open Candidate",
    });
  });

  it("values left-handed pitchers without giving them middle-infield fit credit", () => {
    const team = baseTeam({
      rosterCap: 2,
      players: [
        {
          id: "yes-1",
          name: "Locked Returner",
          returning: true,
          comfortablePositions: ["C"],
        },
      ],
    });
    const projection = computeRosterProjection(
      team,
      session("lefty-1", grade(3, ["P", "SS"])),
      [
        {
          id: "lefty-1",
          firstName: "Lefty",
          lastName: "Arm",
          status: "tryout",
          throws: "L",
          tryoutDate: "2026-07-01",
        },
      ],
      [],
    );

    expect(projection.recommended[0].fitReasons).toEqual(["fills P"]);
    expect(projection.recommended[0].fitBonus).toBe(8);
  });

  it("surfaces ungraded candidates as needing evaluation", () => {
    const team = baseTeam({
      players: [
        {
          id: "yes-1",
          name: "Locked Returner",
          returning: true,
          comfortablePositions: ["P"],
        },
        {
          id: "unk-1",
          name: "Ungraded Returner",
          comfortablePositions: ["SS"],
        },
      ],
    });
    const projection = computeRosterProjection(
      team,
      [],
      [
        {
          id: "try-1",
          firstName: "Ungraded",
          lastName: "Tryout",
          status: "tryout",
          tryoutDate: "2026-07-01",
        },
      ],
      [],
    );
    expect(projection.needsEvaluation.map((c) => c.name)).toEqual([
      "Ungraded Returner",
      "Ungraded Tryout",
    ]);
    expect(projection.recommended).toHaveLength(0);
  });

  it("excludes declined and too-old tryouts from ranked candidates", () => {
    const projection = computeRosterProjection(
      baseTeam(),
      session("old-1", grade(5, ["C"])),
      [
        {
          id: "declined-1",
          firstName: "Declined",
          lastName: "Kid",
          status: "declined",
          tryoutDate: "2026-07-01",
        },
        {
          id: "old-1",
          firstName: "Old",
          lastName: "Kid",
          status: "tryout",
          dob: "2010-01-01",
          tryoutDate: "2026-07-01",
        },
      ],
      [],
    );
    expect(projection.recommended).toHaveLength(0);
    expect(projection.tooOld).toHaveLength(1);
    expect(projection.tooOld[0].id).toBe("old-1");
  });
});
