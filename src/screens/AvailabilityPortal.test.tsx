import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDocs, updateDoc } from "firebase/firestore";

vi.mock("../firebase", () => ({ auth: {}, appId: "app", db: {} }));
vi.mock("firebase/auth", () => ({
  signInAnonymously: vi.fn(() => Promise.resolve()),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  getDocs: vi.fn(),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  updateDoc: vi.fn(() => Promise.resolve()),
  arrayUnion: vi.fn((v) => ({ __arrayUnion: v })),
}));

import { AvailabilityPortal } from "./AvailabilityPortal";

const mockGetDocs = getDocs as unknown as ReturnType<typeof vi.fn>;
const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;

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
  mockUpdateDoc.mockClear();
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
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("does not submit without a DOB (required field gates the write)", async () => {
    renderPortal();
    await screen.findByText("Submit Availability");

    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    // DOB left blank — the field is `required`, so the write never fires.
    fireEvent.click(screen.getByText("Submit Availability"));

    await Promise.resolve();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("appends a submission with the added date range once valid", async () => {
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

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1));
    const sub =
      mockUpdateDoc.mock.calls[0][1].availabilitySubmissions.__arrayUnion;
    expect(sub.firstName).toBe("Ava");
    expect(sub.dob).toBe("2015-04-10");
    expect(sub.dates).toEqual(["2099-07-04", "2099-07-05", "2099-07-06"]);
    expect(sub.id).toMatch(/^av-/);
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
