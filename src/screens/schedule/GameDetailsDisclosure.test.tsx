import React from "react";
import { render, screen } from "@testing-library/react";
import {
  GameDetailsDisclosure,
  gameDetailsSummary,
} from "./GameDetailsDisclosure";

const base = {
  leagueRuleSet: "NKB",
  gameType: "league",
  pitchingFormat: "Machine Pitch",
  defenseSize: "10",
  positionLock: "2",
  battingSize: "roster",
};

describe("gameDetailsSummary", () => {
  it("leaves out Rec / League on a Rec game, where it goes without saying", () => {
    expect(gameDetailsSummary(base).setup).toEqual([
      "Rec",
      "Machine Pitch",
      "10 fielders",
      "Rotate every 2 inn",
      "Bat the roster",
    ]);
  });

  it("names the classification when it isn't the plain Rec default", () => {
    expect(
      gameDetailsSummary({
        ...base,
        leagueRuleSet: "USSSA",
        gameType: "bracket",
      }).setup.slice(0, 2),
    ).toEqual(["Tournament", "Bracket"]);
    expect(gameDetailsSummary({ ...base, gameType: "pool" }).setup[1]).toBe(
      "Pool Play",
    );
  });

  it("words the rotation the way a coach would say it", () => {
    const rotation = (positionLock: any) =>
      gameDetailsSummary({ ...base, positionLock }).setup[3];
    expect(rotation("1")).toBe("Rotate every inning");
    expect(rotation("full")).toBe("Full-game positions");
    expect(rotation(3)).toBe("Rotate every 3 inn");
    // A team that never set one says nothing rather than "false inn".
    expect(gameDetailsSummary({ ...base, positionLock: false }).setup).toEqual([
      "Rec",
      "Machine Pitch",
      "10 fielders",
      "Bat the roster",
    ]);
  });

  it("puts home or away and the field with the date", () => {
    expect(
      gameDetailsSummary({ ...base, isHome: false, location: " Field 3 " })
        .when,
    ).toEqual(["Away", "Field 3"]);
    expect(gameDetailsSummary(base).when).toEqual(["Home"]);
  });

  it("flags the settings that change how the lineup is built", () => {
    expect(gameDetailsSummary(base).flags).toEqual([]);
    expect(
      gameDetailsSummary({ ...base, isScrimmage: true, isBigGame: true }).flags,
    ).toEqual(["Scrimmage", "Big Game"]);
    expect(
      gameDetailsSummary({ ...base, applySeasonalFairness: false }).flags,
    ).toEqual(["Even out playing time: off"]);
    // Big Game already turns fairness off; saying both is noise.
    expect(
      gameDetailsSummary({
        ...base,
        isBigGame: true,
        applySeasonalFairness: false,
      }).flags,
    ).toEqual(["Big Game"]);
  });

  it("drops the Rec-only flags on a tournament game, which hides those switches", () => {
    expect(
      gameDetailsSummary({
        ...base,
        isTournamentGame: true,
        isBigGame: true,
        applySeasonalFairness: false,
      }).flags,
    ).toEqual([]);
  });
});

describe("GameDetailsDisclosure", () => {
  const summary = { when: ["Home"], setup: ["Rec"], flags: [] };

  it("starts folded on a phone", () => {
    render(
      <GameDetailsDisclosure summary={summary}>
        <p>Settings</p>
      </GameDetailsDisclosure>,
    );
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  it("starts open on a wide screen", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(
        <GameDetailsDisclosure summary={summary}>
          <p>Settings</p>
        </GameDetailsDisclosure>,
      );
      expect(screen.getByText("Settings")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /game details/i }),
      ).toHaveAttribute("aria-expanded", "true");
    } finally {
      window.matchMedia = original;
    }
  });
});
