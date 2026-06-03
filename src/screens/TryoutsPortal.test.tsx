import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDocs, setDoc } from "firebase/firestore";

// Stub Firebase so the public portal renders without a real backend. vi.mock is
// hoisted above the imports, so TryoutsPortal pulls in these stubs.
vi.mock("../firebase", () => ({ auth: {}, appId: "app", db: {} }));
vi.mock("firebase/auth", () => ({
  signInAnonymously: vi.fn(() => Promise.resolve()),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  // Encode the doc path so assertions can verify signups land in the right
  // subcollection.
  doc: vi.fn((_db: any, ...path: string[]) => ({ path: path.join("/") })),
  getDocs: vi.fn(),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  setDoc: vi.fn(() => Promise.resolve()),
}));

import { TryoutsPortal } from "./TryoutsPortal";

const mockGetDocs = getDocs as unknown as ReturnType<typeof vi.fn>;
const mockSetDoc = setDoc as unknown as ReturnType<typeof vi.fn>;

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

const renderPortal = () => {
  // Queries fire in order: tryoutShareId, tryoutDateSlugs (array-contains),
  // tryoutDateSlug (legacy). Share resolves → interest mode; the rest are empty.
  mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
  mockGetDocs
    .mockResolvedValueOnce({ empty: false, docs: [mirrorDoc] })
    .mockResolvedValueOnce({ empty: true, docs: [] })
    .mockResolvedValueOnce({ empty: true, docs: [] });
  return render(
    <MemoryRouter initialEntries={["/p/abc"]}>
      <Routes>
        <Route path="/p/:slug" element={<TryoutsPortal />} />
      </Routes>
    </MemoryRouter>
  );
};

// A per-date tryout link. The mirror carries the slug→date mapping; the portal
// must pin the signup to THIS slug's date, not the first configured date.
const dateMirrorDoc = {
  id: "team1",
  data: () => ({
    name: "Rockets",
    currentSeason: "Spring 2026",
    teamAge: "10U",
    tryoutsOpen: true,
    tryoutDates: ["2026-04-10", "2026-05-22"],
    tryoutDateSlugs: ["rockets-2026-04-10-aaa", "rockets-2026-05-22-bbb"],
    tryoutDateBySlug: {
      "rockets-2026-04-10-aaa": "2026-04-10",
      "rockets-2026-05-22-bbb": "2026-05-22",
    },
  }),
};

const renderDatePortal = (slug: string) => {
  mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
  mockGetDocs
    .mockResolvedValueOnce({ empty: true, docs: [] }) // shareId query
    .mockResolvedValueOnce({ empty: false, docs: [dateMirrorDoc] }) // array-contains
    .mockResolvedValueOnce({ empty: true, docs: [] }); // legacy slug query
  return render(
    <MemoryRouter initialEntries={[`/p/${slug}`]}>
      <Routes>
        <Route path="/p/:slug" element={<TryoutsPortal />} />
      </Routes>
    </MemoryRouter>
  );
};

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => {
  mockGetDocs.mockReset();
  mockSetDoc.mockClear();
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
    fireEvent.click(screen.getByText("Submit Interest"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/valid parent email/i);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("trims/clamps fields and writes the lead to the interestSignups subcollection", async () => {
    renderPortal();
    await screen.findByText("Submit Interest");

    fill(/first name/i, "  Ava  ");
    fill(/last name/i, "Rivera");
    fill(/email/i, "parent@example.com");
    fill(/phone/i, "5551234");
    fireEvent.click(screen.getByText("Submit Interest"));

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));
    const [ref, lead] = mockSetDoc.mock.calls[0];
    expect(ref.path).toContain("/interestSignups/");
    expect(lead.firstName).toBe("Ava"); // trimmed
    expect(lead.email).toBe("parent@example.com");
  });
});

describe("TryoutsPortal per-date links", () => {
  const submitTryout = async () => {
    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    fill(/current team/i, "Comets");
    fill(/email/i, "parent@example.com");
    fill(/phone/i, "5551234");
    fireEvent.click(screen.getByText("Submit Signup"));
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1));
    const [ref, signup] = mockSetDoc.mock.calls[0];
    expect(ref.path).toContain("/tryoutSignups/");
    return signup;
  };

  it("pins the signup to the SECOND date's slug (not the first)", async () => {
    renderDatePortal("rockets-2026-05-22-bbb");
    await screen.findByText("Submit Signup");
    const signup = await submitTryout();
    expect(signup.tryoutDate).toBe("2026-05-22");
  });

  it("pins the signup to the FIRST date's slug", async () => {
    renderDatePortal("rockets-2026-04-10-aaa");
    await screen.findByText("Submit Signup");
    const signup = await submitTryout();
    expect(signup.tryoutDate).toBe("2026-04-10");
  });
});
