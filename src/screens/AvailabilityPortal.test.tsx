import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import { newSignupId, upsertSignupDoc } from "../utils/tryoutSignupDocs";

vi.mock("../firebase", () => ({ auth: {}, appId: "app", db: {} }));
vi.mock("firebase/auth", () => ({
  signInAnonymously: vi.fn(() => Promise.resolve()),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  getDocs: vi.fn(),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
}));
// The per-entry submission write (Phase 1b): the portal mints a Firestore
// auto-id and setDocs its own doc — no team-doc arrayUnion anymore.
vi.mock("../utils/tryoutSignupDocs", () => ({
  newSignupId: vi.fn(() => "aAbBcCdDeEfFgGhHiIjJ"),
  upsertSignupDoc: vi.fn(() => Promise.resolve()),
}));

import { AvailabilityPortal } from "./AvailabilityPortal";

const mockGetDocs = getDocs as unknown as ReturnType<typeof vi.fn>;
const mockNewSignupId = newSignupId as unknown as ReturnType<typeof vi.fn>;
const mockUpsert = upsertSignupDoc as unknown as ReturnType<typeof vi.fn>;

const mirrorDoc = {
  id: "team1",
  data: () => ({ name: "Rockets", tryoutShareId: "abc" }),
};

const renderPortal = (doc = mirrorDoc) => {
  mockGetDocs.mockResolvedValueOnce({ empty: false, docs: [doc] });
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
  mockGetDocs.mockReset();
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
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });
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
