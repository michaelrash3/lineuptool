import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDocs, updateDoc } from "firebase/firestore";

// Stub Firebase so the public portal renders without a real backend. vi.mock is
// hoisted above the imports, so TryoutsPortal pulls in these stubs.
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

import { TryoutsPortal } from "./TryoutsPortal";

const mockGetDocs = getDocs as unknown as ReturnType<typeof vi.fn>;
const mockUpdateDoc = updateDoc as unknown as ReturnType<typeof vi.fn>;

// A standing share link → interest survey. First getDocs (shareId query)
// returns the team mirror; second (dateSlug query) is empty.
const mirrorDoc = {
  id: "team1",
  data: () => ({
    name: "Rockets",
    currentSeason: "Spring 2026",
    tryoutShareId: "abc",
    teamAge: "10U",
  }),
};

const renderPortal = (doc = mirrorDoc) => {
  mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
  mockGetDocs.mockResolvedValueOnce({ empty: false, docs: [doc] });
  return render(
    <MemoryRouter initialEntries={["/p/abc"]}>
      <Routes>
        <Route path="/p/:slug" element={<TryoutsPortal />} />
      </Routes>
    </MemoryRouter>,
  );
};

const datedMirrorDoc = {
  id: "team1",
  data: () => ({
    name: "Rockets",
    currentSeason: "Spring 2026",
    tryoutShareId: "abc",
    teamAge: "10U",
    tryoutsOpen: true,
    tryoutDates: ["2020-04-10", "2099-05-22"],
  }),
};

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  mockGetDocs.mockReset();
  mockUpdateDoc.mockClear();
});

describe("TryoutsPortal interest header", () => {
  it.each(["Spring 2026", "Fall 2026"])(
    "shows next spring season and next age for an 8U %s team",
    async (currentSeason) => {
      const eightUMirrorDoc = {
        id: "team1",
        data: () => ({
          name: "Rockets",
          currentSeason,
          tryoutShareId: "abc",
          teamAge: "8U",
        }),
      };

      renderPortal(eightUMirrorDoc);

      expect(await screen.findByText("Spring 2027 · 9U")).toBeInTheDocument();
    },
  );
});

describe("TryoutsPortal submit validation", () => {
  it("blocks an invalid email and does not write to Firestore", async () => {
    renderPortal();
    await screen.findByText("Submit Interest");

    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    // "a@b" passes the browser's native type=email check but fails our stricter
    // isValidEmail (which requires a dotted domain) — exercises our guard, not
    // jsdom's. A blatantly malformed value would be blocked before our JS runs.
    fill(/email/i, "a@b");
    fill(/phone/i, "5551234");
    fireEvent.change(screen.getByLabelText(/does your player pitch/i), {
      target: { value: "no" },
    });
    fireEvent.change(screen.getByLabelText(/does your player catch/i), {
      target: { value: "no" },
    });
    fireEvent.click(screen.getByText("Submit Interest"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/valid parent email/i);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("trims/clamps fields and writes the signup once valid", async () => {
    renderPortal();
    await screen.findByText("Submit Interest");

    fill(/first name/i, "  Ava  ");
    fill(/last name/i, "Rivera");
    fill(/email/i, "parent@example.com");
    fill(/phone/i, "5551234");
    fireEvent.change(screen.getByLabelText(/does your player pitch/i), {
      target: { value: "yes" },
    });
    fireEvent.change(screen.getByLabelText(/does your player catch/i), {
      target: { value: "no" },
    });
    fireEvent.click(screen.getByText("Submit Interest"));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1));
    const lead = mockUpdateDoc.mock.calls[0][1].interestSignups.__arrayUnion;
    expect(lead.firstName).toBe("Ava"); // trimmed
    expect(lead.email).toBe("parent@example.com");
  });
});

describe("TryoutsPortal tryout dates on interest link", () => {
  it("shows only future dates and stores a selected open tryout date as a tryout signup", async () => {
    renderPortal(datedMirrorDoc);
    await screen.findByText("Submit Interest");

    expect(screen.queryByText("2020-04-10")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/tryout date/i), {
      target: { value: "2099-05-22" },
    });
    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    fill(/email/i, "parent@example.com");
    fill(/phone/i, "5551234");
    fireEvent.change(screen.getByLabelText(/primary position/i), {
      target: { value: "P" },
    });
    fireEvent.change(screen.getByLabelText(/does your player catch/i), {
      target: { value: "yes" },
    });
    fireEvent.click(screen.getByText("Submit Interest"));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1));
    const signup = mockUpdateDoc.mock.calls[0][1].tryoutSignups.__arrayUnion;
    expect(signup.tryoutDate).toBe("2099-05-22");
    expect(signup.status).toBe("tryout");
    expect(signup.primaryPosition).toBe("P");
    expect(signup.canPitch).toBe(true);
    expect(signup.canCatch).toBe(true);
  });

  it("keeps selected dates as interest leads when tryouts are not open", async () => {
    renderPortal({
      id: "team1",
      data: () => ({
        name: "Rockets",
        currentSeason: "Spring 2026",
        tryoutShareId: "abc",
        teamAge: "10U",
        tryoutsOpen: false,
        tryoutDates: ["2099-05-22"],
      }),
    });
    await screen.findByText("Submit Interest");

    fireEvent.change(screen.getByLabelText(/tryout date/i), {
      target: { value: "2099-05-22" },
    });
    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    fill(/email/i, "parent@example.com");
    fill(/phone/i, "5551234");
    fireEvent.change(screen.getByLabelText(/does your player pitch/i), {
      target: { value: "no" },
    });
    fireEvent.change(screen.getByLabelText(/does your player catch/i), {
      target: { value: "no" },
    });
    fireEvent.click(screen.getByText("Submit Interest"));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1));
    const lead = mockUpdateDoc.mock.calls[0][1].interestSignups.__arrayUnion;
    expect(lead.tryoutDate).toBe("2099-05-22");
  });
});
