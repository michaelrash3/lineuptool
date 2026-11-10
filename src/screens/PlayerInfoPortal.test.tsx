import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDocs } from "firebase/firestore";
import { newSignupId, upsertSignupDoc } from "../utils/tryoutSignupDocs";

// Stub Firebase so the public portal renders without a real backend.
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

import { PlayerInfoPortal } from "./PlayerInfoPortal";

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
        <Route path="/p/:slug" element={<PlayerInfoPortal />} />
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

describe("PlayerInfoPortal", () => {
  it("blocks an invalid email and does not write to Firestore", async () => {
    renderPortal();
    await screen.findByText("Submit Player Info");

    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    fill(/email \*/i, "a@b"); // passes native check, fails our stricter isValidEmail
    fill(/phone \*/i, "5551234");
    fireEvent.click(screen.getByText("Submit Player Info"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/valid parent email/i);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("trims/clamps fields and writes the submission as its own doc once valid", async () => {
    renderPortal();
    await screen.findByText("Submit Player Info");

    fill(/first name/i, "  Ava  ");
    fill(/last name/i, "Rivera");
    fill(/date of birth/i, "2015-04-10");
    fill(/email \*/i, "parent@example.com");
    fill(/phone \*/i, "5551234");
    fill(/hat size/i, "MED-LG");
    fill(/shirt \/ jersey size/i, "Adult S");
    fill(/grade/i, "5th");
    fill(/^name$/i, "Grandma Rivera"); // Parent / Guardian 2 name

    fireEvent.click(screen.getByText("Submit Player Info"));

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [, appId, teamId, key, sub] = mockUpsert.mock.calls[0];
    expect(appId).toBe("app");
    expect(teamId).toBe("team1"); // resolved from the sanitized mirror
    expect(key).toBe("playerInfoSubmissions");
    expect(sub.firstName).toBe("Ava"); // trimmed
    expect(sub.dob).toBe("2015-04-10");
    expect(sub.email).toBe("parent@example.com");
    expect(sub.hatSize).toBe("MED-LG");
    expect(sub.shirtSize).toBe("Adult S");
    expect(sub.grade).toBe("5th");
    expect(sub.parent2Name).toBe("Grandma Rivera");
    // Firestore auto-id from newSignupId — collision-safe AND long enough to
    // pass the rules' legacy-id shadowing floor (20 chars).
    expect(mockNewSignupId).toHaveBeenCalledWith(
      expect.anything(),
      "app",
      "team1",
      "playerInfoSubmissions",
    );
    expect(sub.id).toBe("aAbBcCdDeEfFgGhHiIjJ");
  });

  it("shows an error phase when the share link is not found", async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true, docs: [] });
    render(
      <MemoryRouter initialEntries={["/p/nope"]}>
        <Routes>
          <Route path="/p/:slug" element={<PlayerInfoPortal />} />
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
describe("PlayerInfoPortal — offline vs. a dead link", () => {
  const renderAt = () =>
    render(
      <MemoryRouter initialEntries={["/p/abc"]}>
        <Routes>
          <Route path="/p/:slug" element={<PlayerInfoPortal />} />
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
