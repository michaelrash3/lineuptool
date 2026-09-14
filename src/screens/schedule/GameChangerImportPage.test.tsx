import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameChangerImportPage } from "./GameChangerImportPage";
import { applyTeamOps, renderWithProviders } from "../../test-utils";

// Dates relative to the run's own "today", so the prune fences (which compare
// against the wall clock) mean the same thing whenever CI runs this.
const isoInDays = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, "0")}`;
};

// An all-day VEVENT — a literal feed date, no timezone conversion to reason
// about in the assertions.
const icsFeed = (
  events: { uid: string; date: string; summary: string }[],
): string =>
  [
    "BEGIN:VCALENDAR",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, "")}`,
      `SUMMARY:${e.summary}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");

const stubFeed = (ics: string) => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    text: async () => ics,
  });
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
};

const renderPage = (teamOver: any = {}, roleOver: any = {}) => {
  const updateTeam = jest.fn();
  const updateTeamArrays = jest.fn();
  const utils = renderWithProviders(
    <MemoryRouter initialEntries={["/schedule/import/gamechanger"]}>
      <Routes>
        <Route path="/schedule" element={<div>SCHEDULE LIST</div>} />
        <Route
          path="/schedule/import/gamechanger"
          element={<GameChangerImportPage />}
        />
      </Routes>
    </MemoryRouter>,
    {
      team: {
        team: { games: [], ...teamOver },
        currentRole: "head",
        updateTeam,
        updateTeamArrays,
        ...roleOver,
      },
    },
  );
  return { ...utils, updateTeam, updateTeamArrays };
};

describe("GameChangerImportPage", () => {
  it("renders as a page with the feed input and preview action", () => {
    renderPage();
    expect(screen.getByText("Import from GameChanger")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/webcal:\/\/api\.team-manager/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /preview games/i }),
    ).toBeInTheDocument();
  });

  it("shows a remove button only when a feed is saved, and clears it", () => {
    const { updateTeam } = renderPage({
      gcCalendarUrl: "webcal://old.season/feed.ics",
    });
    const remove = screen.getByRole("button", { name: /remove saved feed/i });
    fireEvent.click(remove);
    expect(updateTeam).toHaveBeenCalledWith({ gcCalendarUrl: "" });
  });

  it("hides the remove button without a saved feed", () => {
    renderPage();
    expect(
      screen.queryByRole("button", { name: /remove saved feed/i }),
    ).not.toBeInTheDocument();
  });

  it("Back falls back to the schedule on a deep link", () => {
    window.history.replaceState({ idx: 0 }, "");
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  it("redirects assistants to the schedule", () => {
    renderPage({}, { currentRole: "assistant" });
    expect(screen.getByText("SCHEDULE LIST")).toBeInTheDocument();
  });

  describe("practices GameChanger dropped", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      (globalThis as any).fetch = realFetch;
    });

    // One upcoming GameChanger practice the coach deleted upstream, and a
    // later game that proves the feed still reaches past that date.
    const cancelledDate = isoInDays(7);
    const team = {
      gcCalendarUrl: "webcal://api.team-manager.gc.com/feed.ics",
      games: [],
      practices: [
        {
          id: "pr-gone",
          gcUid: "gone",
          date: cancelledDate,
          location: "Field 4",
          source: "gamechanger",
          status: "scheduled",
        },
      ],
    };
    const feed = () =>
      icsFeed([
        {
          uid: "g1",
          date: isoInDays(14),
          summary: "Trash Pandas 8u vs Dirt Dobbers",
        },
      ]);

    it("warns in the preview before the coach imports", async () => {
      stubFeed(feed());
      renderPage(team, { gamesServerConfirmed: true });
      fireEvent.click(screen.getByRole("button", { name: /preview games/i }));
      expect(
        await screen.findByText(/no longer in this feed/i),
      ).toBeInTheDocument();
      expect(screen.getByText(new RegExp(cancelledDate))).toBeInTheDocument();
    });

    it("drops it on import and says so", async () => {
      stubFeed(feed());
      const { updateTeamArrays, toastValue } = renderPage(team, {
        gamesServerConfirmed: true,
      });
      fireEvent.click(screen.getByRole("button", { name: /preview games/i }));
      await screen.findByText(/no longer in this feed/i);
      fireEvent.click(screen.getByRole("button", { name: /^import 1 game$/i }));

      await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
      const next = applyTeamOps(team, updateTeamArrays.mock.calls[0][0]);
      expect(next.practices).toEqual([]);
      expect(next.games).toHaveLength(1); // the feed's game still lands
      expect(toastValue.push).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("1 practice removed"),
        }),
      );
    });

    it("leaves a manually-added practice alone", async () => {
      stubFeed(feed());
      const manual = {
        ...team,
        practices: [
          { id: "pr-mine", date: cancelledDate, source: "manual" as const },
        ],
      };
      const { updateTeamArrays } = renderPage(manual, {
        gamesServerConfirmed: true,
      });
      fireEvent.click(screen.getByRole("button", { name: /preview games/i }));
      await screen.findByRole("button", { name: /^import 1 game$/i });
      expect(screen.queryByText(/no longer in this feed/i)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /^import 1 game$/i }));
      await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
      const next = applyTeamOps(manual, updateTeamArrays.mock.calls[0][0]);
      expect(next.practices).toHaveLength(1);
    });
  });
});
