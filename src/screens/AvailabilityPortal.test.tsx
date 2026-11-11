import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDoc } from "firebase/firestore";
import { answerGetDoc, portalDocs, schedulePath } from "./portalTestDocs";
import { newSignupId, upsertSignupDoc } from "../utils/tryoutSignupDocs";

vi.mock("../firebase", () => ({ auth: {}, appId: "app", db: {} }));
vi.mock("firebase/auth", () => ({
  signInAnonymously: vi.fn(() => Promise.resolve()),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  // Every lookup is a single-doc get (portalLinks/{slug}, then the team's
  // mirror by id); answerGetDoc serves them per test.
  doc: vi.fn((...path: unknown[]) => ({ __path: path.slice(1).join("/") })),
  getDoc: vi.fn(),
}));
// The per-entry submission write (Phase 1b): the portal mints a Firestore
// auto-id and setDocs its own doc — no team-doc arrayUnion anymore.
vi.mock("../utils/tryoutSignupDocs", () => ({
  newSignupId: vi.fn(() => "aAbBcCdDeEfFgGhHiIjJ"),
  upsertSignupDoc: vi.fn(() => Promise.resolve()),
}));

import { AvailabilityPortal } from "./AvailabilityPortal";

const mockGetDoc = getDoc as unknown as ReturnType<typeof vi.fn>;
const mockNewSignupId = newSignupId as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = upsertSignupDoc as unknown as ReturnType<typeof vi.fn>;

const mirrorDoc = {
  id: "team1",
  data: () => ({ name: "Rockets", tryoutShareId: "abc" }),
};

// Extra docs a test serves alongside the link (e.g. the schedule days).
let extraDocs: Record<string, unknown> = {};
const renderPortal = (doc = mirrorDoc) => {
  answerGetDoc(mockGetDoc, { ...portalDocs(doc), ...extraDocs });
  return render(
    <MemoryRouter initialEntries={["/p/abc"]}>
      <Routes>
        <Route path="/p/:slug" element={<AvailabilityPortal />} />
      </Routes>
    </MemoryRouter>,
  );
};

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  mockGetDoc.mockReset();
  extraDocs = {};
  mockUpsert.mockClear();
  mockNewSignupId.mockClear();
});

describe("AvailabilityPortal", () => {
  it("blocks submit with no dates selected", async () => {
    renderPortal();
    await screen.findByText("Submit Availability");

    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    fill(/date of birth/i, "2015-04-10");
    fireEvent.click(screen.getByText("Submit Availability"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/at least one date/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does not submit without a DOB (required field gates the write)", async () => {
    renderPortal();
    await screen.findByText("Submit Availability");

    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    // DOB left blank — the field is `required`, so the write never fires.
    fireEvent.click(screen.getByText("Submit Availability"));

    await Promise.resolve();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("writes a submission doc with the added date range once valid", async () => {
    renderPortal();
    await screen.findByText("Submit Availability");

    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    fill(/date of birth/i, "2015-04-10");
    // Add a 3-day range via the range shortcut.
    fill(/^from$/i, "2099-07-04");
    fill(/^to$/i, "2099-07-06");
    fireEvent.click(screen.getByText("Add"));

    fireEvent.click(screen.getByText("Submit Availability"));

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [, appId, teamId, key, sub] = mockUpsert.mock.calls[0];
    expect(appId).toBe("app");
    expect(teamId).toBe("team1"); // resolved from the sanitized mirror
    expect(key).toBe("availabilitySubmissions");
    expect(sub.firstName).toBe("Ava");
    expect(sub.dob).toBe("2015-04-10");
    expect(sub.dates).toEqual(["2099-07-04", "2099-07-05", "2099-07-06"]);
    // Firestore auto-id from newSignupId — collision-safe AND long enough to
    // pass the rules' legacy-id shadowing floor (20 chars).
    expect(mockNewSignupId).toHaveBeenCalledWith(
      expect.anything(),
      "app",
      "team1",
      "availabilitySubmissions",
    );
    expect(sub.id).toBe("aAbBcCdDeEfFgGhHiIjJ");
  });

  it("shows an error phase when the share link is not found", async () => {
    answerGetDoc(mockGetDoc, {}); // no link doc for "nope"
    render(
      <MemoryRouter initialEntries={["/p/nope"]}>
        <Routes>
          <Route path="/p/:slug" element={<AvailabilityPortal />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(/can't open this page/i),
    ).toBeInTheDocument();
  });
});

// Weak signal at the ball field: the lookup can't reach the server and the
// browser's (empty) offline cache answers instead. That must read as a
// connection problem with a retry — never as "your link is dead".
describe("AvailabilityPortal — offline vs. a dead link", () => {
  const renderAt = () =>
    render(
      <MemoryRouter initialEntries={["/p/abc"]}>
        <Routes>
          <Route path="/p/:slug" element={<AvailabilityPortal />} />
        </Routes>
      </MemoryRouter>,
    );

  it("says it couldn't connect, and Try again re-runs the lookup", async () => {
    // Weak signal: nothing came back, and it came from the offline cache.
    answerGetDoc(mockGetDoc, {}, { fromCache: true });
    renderAt();
    expect(
      await screen.findByText(/couldn't reach this team's page/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not found or has been deactivated/i)).toBeNull();
    // Signal's back: the retry finds the link and the form opens.
    answerGetDoc(mockGetDoc, portalDocs(mirrorDoc));
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.queryByText(/can't open this page/i)).toBeNull();
  });

  it("still says a link is dead when the server says so — with no retry", async () => {
    // The server answered: there is no link doc for this slug.
    answerGetDoc(mockGetDoc, {});
    renderAt();
    expect(
      await screen.findByText(/not found or has been deactivated/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});

describe("AvailabilityPortal — the team's game and practice days", () => {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Today (local) is always on the first calendar shown and never "past".
  const today = iso(now);
  const day = String(now.getDate());

  const withSchedule = (sched: Record<string, unknown> | null) => {
    extraDocs = sched ? { [schedulePath()]: sched } : {};
  };
  // The schedule is fetched after the form opens; wait for that read.
  const scheduleRead = () =>
    waitFor(() =>
      expect(
        mockGetDoc.mock.calls.some((c: any[]) =>
          String(c[0]?.__path).includes("portalSchedules"),
        ),
      ).toBe(true),
    );

  it("marks the days the coach shared, with a legend", async () => {
    withSchedule({ teamId: "team1", gameDays: [today], practiceDays: [] });
    renderPortal();
    expect(
      await screen.findByRole("button", { name: `${day}, game` }),
    ).toBeInTheDocument();
    expect(screen.getByText("Game day")).toBeInTheDocument();
    expect(screen.queryByText("Practice")).not.toBeInTheDocument();
  });

  it("can mark a day as both", async () => {
    withSchedule({ teamId: "team1", gameDays: [today], practiceDays: [today] });
    renderPortal();
    expect(
      await screen.findByRole("button", { name: `${day}, game and practice` }),
    ).toBeInTheDocument();
  });

  it("ignores a schedule that belongs to another team", async () => {
    withSchedule({ teamId: "someone-else", gameDays: [today] });
    renderPortal();
    await screen.findByText("Submit Availability");
    await scheduleRead();
    expect(screen.queryByText("Game day")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: day })).toBeInTheDocument();
  });

  it("shows a plain calendar when nothing is shared", async () => {
    withSchedule(null);
    renderPortal();
    await screen.findByText("Submit Availability");
    expect(screen.queryByText("Game day")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: day })).toBeInTheDocument();
  });

  it("lets a family mark today — the local today, not UTC's", async () => {
    // 8pm on May 9 in Los Angeles is already May 10 in UTC. The old UTC
    // "today" greyed May 9 out as past while it was still May 9 at home.
    const prevTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-10T03:00:00Z"));
    try {
      withSchedule(null);
      renderPortal();
      await screen.findByText("Submit Availability");
      expect(screen.getByText("May 2026")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "9" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "8" })).toBeDisabled();
    } finally {
      vi.useRealTimers();
      process.env.TZ = prevTz;
    }
  });
});
