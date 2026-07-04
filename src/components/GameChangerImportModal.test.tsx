import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { GameChangerImportModal } from "./GameChangerImportModal";

const baseProps = () => ({
  open: true,
  onClose: jest.fn(),
  updateTeam: jest.fn(),
  updateTeamArrays: jest.fn(),
  toast: { push: jest.fn() },
});

describe("GameChangerImportModal — remove saved feed", () => {
  it("shows a remove button only when a feed is saved", () => {
    const { rerender } = render(
      <GameChangerImportModal {...baseProps()} team={{ games: [] }} />,
    );
    expect(
      screen.queryByRole("button", { name: /remove saved feed/i }),
    ).not.toBeInTheDocument();

    rerender(
      <GameChangerImportModal
        {...baseProps()}
        team={{ games: [], gcCalendarUrl: "webcal://old.season/feed.ics" }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /remove saved feed/i }),
    ).toBeInTheDocument();
  });

  it("clears the saved feed and the input when removed", () => {
    const props = baseProps();
    render(
      <GameChangerImportModal
        {...props}
        team={{ games: [], gcCalendarUrl: "webcal://old.season/feed.ics" }}
      />,
    );
    // Field is pre-filled with the stale feed.
    const field = screen.getByPlaceholderText(/webcal:\/\//i);
    expect(field).toHaveValue("webcal://old.season/feed.ics");

    fireEvent.click(screen.getByRole("button", { name: /remove saved feed/i }));

    // Persists an empty feed and blanks the field for the new season's link.
    expect(props.updateTeam).toHaveBeenCalledWith({ gcCalendarUrl: "" });
    expect(field).toHaveValue("");
    expect(props.toast.push).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "success" }),
    );
  });
});
