import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import { newSignupId, upsertSignupDoc } from "../utils/tryoutSignupDocs";

// Stub Firebase so the public portal renders without a real backend. vi.mock is
// hoisted above the imports, so TryoutsPortal pulls in these stubs. Submits go
// through the signup-subcollection helpers (Phase 1 of
// docs/firestore-data-migration.md), mocked as a unit so assertions see the
// (collection key, payload) pair rather than raw Firestore plumbing.
vi.mock("../firebase", () => ({ auth: {}, appId: "app", db: {} }));
vi.mock("firebase/auth", () => ({
  signInAnonymously: vi.fn(() => Promise.resolve()),
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  getDocs: vi.fn(),
  // The owned link doc (portalLinks/{slug}). Absent by default, so the
  // existing tests exercise the legacy mirror-query fallback.
  doc: vi.fn((...path: unknown[]) => ({ __path: path.slice(1).join("/") })),
  getDoc: vi.fn(() =>
    Promise.resolve({ exists: () => false, metadata: { fromCache: false } }),
  ),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
}));
vi.mock("../utils/tryoutSignupDocs", () => ({
  newSignupId: vi.fn(() => "signup-doc-1"),
  upsertSignupDoc: vi.fn(() => Promise.resolve()),
}));

import { TryoutsPortal } from "./TryoutsPortal";

const mockGetDocs = getDocs as unknown as ReturnType<typeof vi.fn>;
const mockNewSignupId = newSignupId as unknown as ReturnType<typeof vi.fn>;
const mockUpsertSignupDoc = upsertSignupDoc as unknown as ReturnType<
  typeof vi.fn
>;

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

const renderPortal = (
  doc: { id: string; data: () => Record<string, unknown> } = mirrorDoc,
) => {
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
  mockNewSignupId.mockClear();
  mockUpsertSignupDoc.mockClear();
});

describe("TryoutsPortal interest header", () => {
  const teamMirror = (fields: Record<string, unknown>) => ({
    id: "team1",
    data: () => ({ name: "Rockets", tryoutShareId: "abc", ...fields }),
  });

  it("shows next spring and the next age group for a Spring team", async () => {
    renderPortal(teamMirror({ currentSeason: "Spring 2026", teamAge: "8U" }));
    expect(await screen.findByText("Spring 2027 · 9U")).toBeInTheDocument();
  });

  it("keeps a Fall team's age group for the Spring it already plays in", async () => {
    // Advance Season takes Spring 2026 8U to Fall 2026 9U, and Fall → Spring
    // keeps the tier — so that team's next spring is still 9U, not 10U.
    renderPortal(teamMirror({ currentSeason: "Fall 2026", teamAge: "9U" }));
    expect(await screen.findByText("Spring 2027 · 9U")).toBeInTheDocument();
  });

  it("shows the team's own season and age when signups are for this season", async () => {
    renderPortal(
      teamMirror({
        currentSeason: "Fall 2026",
        teamAge: "9U",
        tryoutTarget: "current",
      }),
    );
    expect(await screen.findByText("Fall 2026 · 9U")).toBeInTheDocument();
  });
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
    expect(mockUpsertSignupDoc).not.toHaveBeenCalled();
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

    await waitFor(() => expect(mockUpsertSignupDoc).toHaveBeenCalledTimes(1));
    const [, , teamId, key, lead] = mockUpsertSignupDoc.mock.calls[0];
    expect(teamId).toBe("team1");
    expect(key).toBe("interestSignups");
    expect(lead.id).toBe("signup-doc-1"); // entry id IS the minted doc id
    expect(lead.firstName).toBe("Ava"); // trimmed
    expect(lead.email).toBe("parent@example.com");
  });
});

describe("TryoutsPortal tryout dates on interest link", () => {
  it("shows only future dates and stores a selected open tryout date as a tryout signup", async () => {
    renderPortal(datedMirrorDoc);
    await screen.findByText("Submit Interest");

    // Past dates are gone; upcoming ones read as dates, not ISO strings.
    expect(screen.queryByText(/2020/)).not.toBeInTheDocument();
    expect(screen.queryByText("2099-05-22")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Friday, May 22, 2099"));
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
    fireEvent.click(screen.getByText("Sign Up for Tryout"));

    await waitFor(() => expect(mockUpsertSignupDoc).toHaveBeenCalledTimes(1));
    const [, , , key, signup] = mockUpsertSignupDoc.mock.calls[0];
    expect(key).toBe("tryoutSignups");
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

    fireEvent.click(screen.getByLabelText("Friday, May 22, 2099"));
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

    await waitFor(() => expect(mockUpsertSignupDoc).toHaveBeenCalledTimes(1));
    const [, , , key, lead] = mockUpsertSignupDoc.mock.calls[0];
    expect(key).toBe("interestSignups");
    expect(lead.tryoutDate).toBe("2099-05-22");
  });
});

// Weak signal at the ball field: the lookup can't reach the server and the
// browser's (empty) offline cache answers instead. That must read as a
// connection problem with a retry — never as "your link is dead".
describe("TryoutsPortal — offline vs. a dead link", () => {
  const renderAt = () =>
    render(
      <MemoryRouter initialEntries={["/p/abc"]}>
        <Routes>
          <Route path="/p/:slug" element={<TryoutsPortal />} />
        </Routes>
      </MemoryRouter>,
    );

  it("says it couldn't connect, and Try again re-runs the lookup", async () => {
    mockGetDocs.mockReset();
    mockGetDocs
      .mockResolvedValueOnce({
        empty: true,
        docs: [],
        metadata: { fromCache: true },
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [mirrorDoc],
        metadata: { fromCache: false },
      });
    renderAt();
    expect(
      await screen.findByText(/couldn't reach this team's page/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not found or has been deactivated/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(mockGetDocs).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText(/can't open this page/i)).toBeNull(),
    );
  });

  it("still says a link is dead when the server says so — with no retry", async () => {
    mockGetDocs.mockReset();
    mockGetDocs.mockResolvedValueOnce({
      empty: true,
      docs: [],
      metadata: { fromCache: false },
    });
    renderAt();
    expect(
      await screen.findByText(/not found or has been deactivated/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});

describe("TryoutsPortal — Which tryout? comes first", () => {
  it("titles the page as tryouts and asks which tryout before anything else", async () => {
    renderPortal(datedMirrorDoc);
    const which = await screen.findByRole("group", { name: /which tryout/i });
    expect(
      screen.getByRole("heading", { level: 1, name: /rockets tryouts/i }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Rockets Tryouts");
    // Above the player's details, not buried after the jersey number.
    const firstName = screen.getByLabelText(/first name/i);
    expect(
      which.compareDocumentPosition(firstName) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("won't submit until the family answers it", async () => {
    renderPortal(datedMirrorDoc);
    await screen.findByRole("group", { name: /which tryout/i });
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
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /pick a tryout date/i,
    );
    expect(mockUpsertSignupDoc).not.toHaveBeenCalled();

    // "Not sure yet" is an answer: it goes to the interest list, undated.
    fireEvent.click(screen.getByLabelText(/not sure yet/i));
    fireEvent.click(screen.getByText("Submit Interest"));
    await waitFor(() => expect(mockUpsertSignupDoc).toHaveBeenCalledTimes(1));
    const [, , , key, lead] = mockUpsertSignupDoc.mock.calls[0];
    expect(key).toBe("interestSignups");
    expect(lead.tryoutDate).toBe("");
  });

  it("confirms a tryout signup with the date written out", async () => {
    renderPortal(datedMirrorDoc);
    await screen.findByRole("group", { name: /which tryout/i });
    fireEvent.click(screen.getByLabelText("Friday, May 22, 2099"));
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
    fireEvent.click(screen.getByText("Sign Up for Tryout"));
    expect(await screen.findByText(/you're signed up/i)).toBeInTheDocument();
    expect(
      screen.getByText(/signed up for the friday, may 22, 2099 tryout/i),
    ).toBeInTheDocument();
  });

  it("stays a Player Interest page with no tryout question when there are no dates", async () => {
    renderPortal();
    await screen.findByText("Submit Interest");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /rockets player interest/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: /which tryout/i }),
    ).not.toBeInTheDocument();
  });
});

describe("TryoutsPortal — a same-day tryout in a US evening", () => {
  it("still lists tonight's tryout after UTC has rolled to tomorrow", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
    // 8pm May 9 in Los Angeles = 03:00 May 10 UTC.
    vi.setSystemTime(new Date("2026-05-10T03:00:00Z"));
    try {
      renderPortal({
        id: "team1",
        data: () => ({
          name: "Rockets",
          tryoutShareId: "abc",
          tryoutsOpen: true,
          tryoutDates: ["2026-05-09"],
        }),
      });
      expect(
        await screen.findByLabelText("Saturday, May 9"),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      process.env.TZ = prevTz;
    }
  });
});
