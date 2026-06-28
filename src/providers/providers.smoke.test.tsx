import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The component test suite renders screens with MOCK contexts
// (renderWithProviders), so nothing otherwise mounts the REAL providers that
// were extracted out of App.tsx. This smoke test composes the actual provider
// tree (ToastProvider › ConfirmProvider › TeamProvider › UIProvider) with
// Firebase stubbed to an unauthenticated state, and asserts it mounts and
// supplies all three contexts to a consumer without throwing.

vi.mock("../firebase", () => ({ auth: {}, db: {}, appId: "test-app" }));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    cb(null); // resolve to "signed out"
    return () => {};
  },
  getRedirectResult: () => Promise.resolve(null),
  isSignInWithEmailLink: () => false,
  signInWithEmailLink: vi.fn(),
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  GoogleAuthProvider: class {},
  setPersistence: () => Promise.resolve(),
  browserLocalPersistence: {},
  getAuth: () => ({}),
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(() => ({})),
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  onSnapshot: () => () => {}, // returns an unsubscribe
  getDoc: vi.fn(() =>
    Promise.resolve({ exists: () => false, data: () => ({}) }),
  ),
  getDocs: vi.fn(() => Promise.resolve({ empty: true, docs: [] })),
  setDoc: vi.fn(() => Promise.resolve()),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  arrayRemove: vi.fn((v) => ({ __arrayRemove: v })),
  arrayUnion: vi.fn((v) => ({ __arrayUnion: v })),
  serverTimestamp: vi.fn(() => ({})),
  DocumentSnapshot: class {},
  FirestoreError: class {},
}));

import { ToastProvider } from "./ToastProvider";
import { TeamProvider } from "./TeamProvider";
import { UIProvider } from "./UIProvider";
import { ConfirmProvider } from "../components/ConfirmDialog";
import { useTeam, useUI, useToast } from "../contexts";

const Probe = () => {
  const team = useTeam();
  const ui = useUI();
  const toast = useToast();
  const ok =
    !!team &&
    !!ui &&
    typeof toast.push === "function" &&
    typeof ui.setActiveTab === "function";
  return <div>providers:{ok ? "ok" : "missing"}</div>;
};

describe("provider tree (real providers)", () => {
  it("composes ToastProvider › ConfirmProvider › TeamProvider › UIProvider and supplies every context", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <TeamProvider>
              <UIProvider>
                <Probe />
              </UIProvider>
            </TeamProvider>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("providers:ok")).toBeInTheDocument();
  });
});
