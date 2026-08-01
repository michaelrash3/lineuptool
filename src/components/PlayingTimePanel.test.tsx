import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { PlayingTimePanel } from "./PlayingTimePanel";
import { renderWithProviders } from "../test-utils";

// The season math is covered in utils/playingTime.test.ts and the printable
// assembly in stats/playingTimeReportPdf.test.ts. These cover the card's
// wiring: who can see it, when it appears, and that what's on screen is the
// same sentence the PDF prints.

const NAMES: Record<string, string> = {
  w: "Wes",
  x: "Xan",
  y: "Yuli",
  z: "Zeke",
};
const slim = (id: string) => ({ id, name: NAMES[id], number: "" });
const inn = (fielders: [string, string], bench: string[]) => ({
  P: slim(fielders[0]),
  C: slim(fielders[1]),
  BENCH: bench.map(slim),
});

const finalGame = {
  id: "g1",
  date: "2026-04-04",
  opponent: "Hawks",
  status: "final",
  teamScore: 3,
  opponentScore: 1,
  lineup: [
    inn(["w", "x"], ["y", "z"]),
    inn(["y", "z"], ["w", "x"]),
    inn(["w", "y"], ["x", "z"]),
  ],
};

const players = [
  { id: "w", name: "Wes", number: "3" },
  { id: "x", name: "Xan" },
  { id: "y", name: "Yuli", number: "12" },
  { id: "z", name: "Zeke" },
];

const renderPanel = (over: any = {}, teamOver: any = {}) =>
  renderWithProviders(<PlayingTimePanel />, {
    team: {
      team: { players, games: [finalGame], ...over },
      currentRole: "head",
      ...teamOver,
    },
  });

describe("PlayingTimePanel", () => {
  it("shows a read-aloud line and the position breakdown for each kid", () => {
    renderPanel();
    expect(screen.getByText("Playing Time")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Xan: 1 defensive inning, 1 position, sat 2 innings, sat back-to-back 1 time.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Where those innings went: C 1 · P 1/),
    ).toBeInTheDocument();
  });

  it("states which games it counted, and names the ones it skipped", () => {
    renderPanel({
      games: [
        finalGame,
        { ...finalGame, id: "g2", isScrimmage: true },
        {
          ...finalGame,
          id: "g3",
          status: "draft",
          teamScore: "",
          opponentScore: "",
        },
      ],
    });
    expect(
      screen.getByText(
        "Season totals from 1 finalized game. Not counted: 1 scrimmage and 1 game not final yet.",
      ),
    ).toBeInTheDocument();
  });

  it("opens the player profile from a name", () => {
    const { uiValue } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "#3 Wes" }));
    expect(uiValue.openPlayerProfile).toHaveBeenCalledWith("w");
  });

  it("is head-coach only", () => {
    const { container } = renderPanel({}, { currentRole: "assistant" });
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden until a finalized game has a lineup", () => {
    const { container } = renderPanel({
      games: [
        { ...finalGame, status: "draft", teamScore: "", opponentScore: "" },
      ],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves departed players out", () => {
    renderPanel({
      players: [
        ...players.slice(0, 3),
        { ...players[3], rosterStatus: "departed" },
      ],
    });
    expect(screen.queryByText(/^Zeke:/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Xan:/)).toBeInTheDocument();
  });
});
