import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { ArmCarePanel } from "./ArmCarePanel";
import { renderWithProviders } from "../test-utils";

// The pure log math (dedupe, recency mirrors, cap) is covered in
// utils/helpers.test.ts. These tests cover the editor wiring: that the coach
// can open a pitcher's outing log and that every edit/delete/add writes the
// player back through the pure helper results (updatePlayer with a rebuilt
// `pitching`), never ad-hoc log surgery.

const ace = () => ({
  id: "p1",
  name: "Ace",
  number: "1",
  comfortablePositions: ["P"],
  pitching: {
    recentPitches: 60,
    lastPitchDate: "2026-05-01",
    log: [{ date: "2026-05-01", pitches: 60, gameId: "g1" }],
  },
});

const renderPanel = (over: any = {}) => {
  const updatePlayer = jest.fn();
  const utils = renderWithProviders(<ArmCarePanel />, {
    team: {
      team: {
        players: [ace()],
        games: [],
        teamAge: "10U",
        pitchingFormat: "Kid Pitch",
        ...over,
      },
      currentRole: "head",
      updatePlayer,
    },
  });
  return { ...utils, updatePlayer };
};

describe("ArmCarePanel log editor", () => {
  it("opens the outing log from the Edit log button", () => {
    renderPanel();
    fireEvent.click(screen.getByLabelText("Edit Ace's pitch log"));
    expect(screen.getByLabelText("Outing date")).toHaveValue("2026-05-01");
    expect(screen.getByLabelText("Pitches thrown")).toHaveValue(60);
    // Imported entries are labeled so the coach knows a re-import updates them.
    expect(screen.getByText("Game")).toBeInTheDocument();
    // The manual-add hint: bullpen workload is invisible to the rest rules
    // until it's logged, so the editor says where it goes.
    expect(
      screen.getByText("Bullpens count — log them here too."),
    ).toBeInTheDocument();
  });

  it("saves an edited amount + date through the helper (gameId preserved)", () => {
    const { updatePlayer } = renderPanel();
    fireEvent.click(screen.getByLabelText("Edit Ace's pitch log"));
    fireEvent.change(screen.getByLabelText("Pitches thrown"), {
      target: { value: "35" },
    });
    fireEvent.change(screen.getByLabelText("Outing date"), {
      target: { value: "2026-05-02" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(updatePlayer).toHaveBeenCalledTimes(1);
    const [id, patch] = updatePlayer.mock.calls[0];
    expect(id).toBe("p1");
    expect(patch.pitching.log).toEqual([
      { date: "2026-05-02", pitches: 35, gameId: "g1" },
    ]);
    // Recency mirrors recomputed by the helper, not echoed from the form.
    expect(patch.pitching.lastPitchDate).toBe("2026-05-02");
    expect(patch.pitching.recentPitches).toBe(35);
  });

  it("Save stays disabled until the entry is actually changed and valid", () => {
    const { updatePlayer } = renderPanel();
    fireEvent.click(screen.getByLabelText("Edit Ace's pitch log"));
    const save = screen.getByText("Save");
    expect(save).toBeDisabled(); // pristine
    fireEvent.change(screen.getByLabelText("Pitches thrown"), {
      target: { value: "0" },
    });
    expect(save).toBeDisabled(); // invalid
    fireEvent.click(save);
    expect(updatePlayer).not.toHaveBeenCalled();
  });

  it("deletes an outing through the helper", () => {
    const { updatePlayer } = renderPanel();
    fireEvent.click(screen.getByLabelText("Edit Ace's pitch log"));
    fireEvent.click(screen.getByLabelText("Delete outing"));
    const [, patch] = updatePlayer.mock.calls[0];
    expect(patch.pitching.log).toEqual([]);
    expect(patch.pitching.recentPitches).toBe(0);
    expect(patch.pitching.lastPitchDate).toBeNull();
  });

  it("adds the back half of a split as a second entry (nothing replaced)", () => {
    const { updatePlayer } = renderPanel();
    fireEvent.click(screen.getByLabelText("Edit Ace's pitch log"));
    fireEvent.change(screen.getByLabelText("New outing date"), {
      target: { value: "2026-05-03" },
    });
    fireEvent.change(screen.getByLabelText("New outing pitches"), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByText("Add outing"));
    const [, patch] = updatePlayer.mock.calls[0];
    expect(patch.pitching.log).toEqual([
      { date: "2026-05-03", pitches: 25 },
      { date: "2026-05-01", pitches: 60, gameId: "g1" },
    ]);
  });

  it("flags a date carrying BOTH a manual and a game entry as counted together", () => {
    // A manual outing has no gameId, so the import's gameId dedupe can never
    // match it — if the coach hand-entered the outing before the CSV landed,
    // the day silently counts double in rest math. The editor must surface
    // that; it never merges silently.
    renderPanel({
      players: [
        {
          ...ace(),
          pitching: {
            recentPitches: 80,
            lastPitchDate: "2026-05-01",
            log: [
              { date: "2026-05-01", pitches: 60, gameId: "g1" },
              { date: "2026-05-01", pitches: 20 }, // manual duplicate
            ],
          },
        },
      ],
    });
    fireEvent.click(screen.getByLabelText("Edit Ace's pitch log"));
    expect(
      screen.getByText(
        /2026-05-01: manual \+ game entries counted together — 80 total on this date/,
      ),
    ).toBeInTheDocument();
  });

  it("shows no counted-together chip when all of a date's entries are the same kind", () => {
    // Two game entries on one date is a real doubleheader; two manual entries
    // are a deliberate split — neither is the invisible manual+import overlap.
    renderPanel({
      players: [
        {
          ...ace(),
          pitching: {
            recentPitches: 55,
            lastPitchDate: "2026-05-01",
            log: [
              { date: "2026-05-01", pitches: 30, gameId: "g1" },
              { date: "2026-05-01", pitches: 25, gameId: "g2" },
            ],
          },
        },
      ],
    });
    fireEvent.click(screen.getByLabelText("Edit Ace's pitch log"));
    expect(screen.queryByText(/counted together/)).not.toBeInTheDocument();
  });

  it("hides entirely for assistants and non-kid-pitch formats", () => {
    const updatePlayer = jest.fn();
    const { container } = renderWithProviders(<ArmCarePanel />, {
      team: {
        team: {
          players: [ace()],
          games: [],
          teamAge: "8U",
          pitchingFormat: "Machine Pitch",
        },
        currentRole: "head",
        updatePlayer,
      },
    });
    expect(container).toBeEmptyDOMElement();

    const assistant = renderWithProviders(<ArmCarePanel />, {
      team: {
        team: {
          players: [ace()],
          games: [],
          teamAge: "10U",
          pitchingFormat: "Kid Pitch",
        },
        currentRole: "assistant",
        updatePlayer,
      },
    });
    expect(assistant.container).toBeEmptyDOMElement();
  });
});
