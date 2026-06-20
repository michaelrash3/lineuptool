import { vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { getDocs, updateDoc } from "firebase/firestore";

// Stub Firebase so the public portal renders without a real backend.
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

import { PlayerInfoPortal } from "./PlayerInfoPortal";

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
        <Route path="/p/:slug" element={<PlayerInfoPortal />} />
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

describe("PlayerInfoPortal", () => {
  it("blocks an invalid email and does not write to Firestore", async () => {
    renderPortal();
    await screen.findByText("Submit Player Info");

    fill(/first name/i, "Ava");
    fill(/last name/i, "Rivera");
    fill(/email/i, "a@b"); // passes native check, fails our stricter isValidEmail
    fill(/^phone/i, "5551234");
    fireEvent.click(screen.getByText("Submit Player Info"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/valid parent email/i);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("trims/clamps fields and appends the submission once valid", async () => {
    renderPortal();
    await screen.findByText("Submit Player Info");

    fill(/first name/i, "  Ava  ");
    fill(/last name/i, "Rivera");
    fill(/email/i, "parent@example.com");
    fill(/^phone/i, "5551234");
    fill(/hat size/i, "YL");
    fill(/shirt \/ jersey size/i, "Adult S");
    fill(/grade/i, "5th");
    fill(/contact name/i, "Grandma Rivera");

    fireEvent.click(screen.getByText("Submit Player Info"));

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1));
    const sub =
      mockUpdateDoc.mock.calls[0][1].playerInfoSubmissions.__arrayUnion;
    expect(sub.firstName).toBe("Ava"); // trimmed
    expect(sub.email).toBe("parent@example.com");
    expect(sub.hatSize).toBe("YL");
    expect(sub.shirtSize).toBe("Adult S");
    expect(sub.grade).toBe("5th");
    expect(sub.emergencyName).toBe("Grandma Rivera");
    expect(sub.id).toMatch(/^pi-/);
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
