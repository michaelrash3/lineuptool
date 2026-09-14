import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GameChangerImportPage } from "./GameChangerImportPage";
import { applyTeamOps, renderWithProviders } from "../../test-utils";

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

  // The prune is measured against the FEED's own span, never the wall clock,
  // so these fixtures use fixed dates.
  describe("practices GameChanger dropped", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      (globalThis as any).fetch = realFetch;
    });

    // Two GameChanger practices the coach deleted upstream — one already
    // played, with attendance on it — plus one older than the feed reaches.
    const team = {
      gcCalendarUrl: "webcal://api.team-manager.gc.com/feed.ics",
      games: [],
      practices: [
        {
          id: "pr-upcoming",
          gcUid: "gone-1",
          date: "2026-06-20",
          location: "Field 4",
          source: "gamechanger",
          status: "scheduled",
        },
        {
          id: "pr-played",
          gcUid: "gone-2",
          date: "2026-05-09",
          source: "gamechanger",
          status: "scheduled",
          attendance: { p1: "absent" },
        },
        {
          id: "pr-ancient",
          gcUid: "gone-3",
          date: "2026-03-01",
          source: "gamechanger",
          status: "scheduled",
        },
      ],
    };
    // Spans May 1 -> Jul 1, so it covers both dropped practices and reaches
    // nowhere near the March one.
    const feed = () =>
      icsFeed([
        { uid: "g-early", date: "2026-05-01", summary: "Pandas vs Rays" },
        { uid: "g-late", date: "2026-07-01", summary: "Pandas vs Dobbers" },
      ]);

    it("names every deletion in the preview, flagging logged work", async () => {
      stubFeed(feed());
      renderPage(team, { gamesServerConfirmed: true });
      fireEvent.click(screen.getByRole("button", { name: /preview games/i }));

      const warning = await screen.findByText(/no longer in this feed/i);
      expect(warning).toHaveTextContent("2 practices");
      expect(
        screen.getByText("2026-06-20", { exact: false }),
      ).toBeInTheDocument();
      // The played one is named AND flagged for what its deletion costs.
      expect(
        screen.getByText(/attendance \/ drills logged/i),
      ).toBeInTheDocument();
    });

    it("explains the practice it left alone, and the span that excluded it", async () => {
      stubFeed(feed());
      renderPage(team, { gamesServerConfirmed: true });
      fireEvent.click(screen.getByRole("button", { name: /preview games/i }));

      // The heading is its own span; the explanation and the list are its
      // siblings inside the panel.
      const panel = (await screen.findByText(/1 practice kept/i)).closest(
        "div",
      );
      expect(panel).toHaveTextContent("2026-05-01");
      expect(panel).toHaveTextContent("2026-07-01");
      expect(panel).toHaveTextContent("2026-03-01");
    });

    it("deletes both on import and says so", async () => {
      stubFeed(feed());
      const { updateTeamArrays, toastValue } = renderPage(team, {
        gamesServerConfirmed: true,
      });
      fireEvent.click(screen.getByRole("button", { name: /preview games/i }));
      await screen.findByText(/no longer in this feed/i);
      fireEvent.click(
        screen.getByRole("button", { name: /^import 2 games$/i }),
      );

      await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
      const next = applyTeamOps(team, updateTeamArrays.mock.calls[0][0]);
      // The two inside the feed's span are gone; the March one survives.
      expect(next.practices.map((p: any) => p.id)).toEqual(["pr-ancient"]);
      expect(next.games).toHaveLength(2); // the feed's games still land
      expect(toastValue.push).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("2 practices removed"),
        }),
      );
    });

    it("leaves a manually-added practice alone", async () => {
      stubFeed(feed());
      const manual = {
        ...team,
        practices: [
          { id: "pr-mine", date: "2026-06-20", source: "manual" as const },
        ],
      };
      const { updateTeamArrays } = renderPage(manual, {
        gamesServerConfirmed: true,
      });
      fireEvent.click(screen.getByRole("button", { name: /preview games/i }));
      await screen.findByRole("button", { name: /^import 2 games$/i });
      expect(screen.queryByText(/no longer in this feed/i)).toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: /^import 2 games$/i }),
      );
      await waitFor(() => expect(updateTeamArrays).toHaveBeenCalled());
      const next = applyTeamOps(manual, updateTeamArrays.mock.calls[0][0]);
      expect(next.practices).toHaveLength(1);
    });
  });
});
