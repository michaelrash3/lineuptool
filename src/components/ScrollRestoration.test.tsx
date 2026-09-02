import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { vi } from "vitest";

// jsdom has no layout, so scrolling is simulated: scrollTo records the call
// and moves the fake scrollY, which is what the restore loop reads back.
let scrollTo: ReturnType<typeof vi.fn>;
let ScrollRestoration: React.ComponentType;

const define = (key: string, value: unknown, target: object = window) =>
  Object.defineProperty(target, key, {
    value,
    configurable: true,
    writable: true,
  });

const setScrollY = (y: number) => define("scrollY", y);

beforeEach(async () => {
  // The offset book is module-level, and MemoryRouter hands every test's
  // first entry the same location key ("default") — so without a fresh module
  // one test's saved offset would bleed into the next.
  vi.resetModules();
  ({ ScrollRestoration } = await import("./ScrollRestoration"));

  setScrollY(0);
  scrollTo = vi.fn((_x: number, y: number) => setScrollY(y));
  define("scrollTo", scrollTo);
  // jsdom's History doesn't implement scrollRestoration; stub it so the
  // hand-off is observable.
  define("scrollRestoration", "auto", window.history);
});

const Nav = () => {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/b")}>go b</button>
      <button onClick={() => navigate(-1)}>back</button>
    </>
  );
};

const renderApp = () =>
  render(
    <MemoryRouter initialEntries={["/a"]}>
      <ScrollRestoration />
      <Nav />
      <Routes>
        <Route path="/a" element={<div>page a</div>} />
        <Route path="/b" element={<div>page b</div>} />
      </Routes>
    </MemoryRouter>,
  );

// Let the rAF the scroll listener defers to actually run.
const flushFrame = async () => {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
};

const scrollPageTo = async (y: number) => {
  setScrollY(y);
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
  });
  await flushFrame();
};

describe("ScrollRestoration", () => {
  it("starts a newly pushed route at the top", async () => {
    const user = userEvent.setup();
    renderApp();
    await scrollPageTo(640);

    scrollTo.mockClear();
    await user.click(screen.getByText("go b"));

    expect(screen.getByText("page b")).toBeInTheDocument();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  // The behavior a multi-page site gets from the browser for free: Back puts
  // you where you were, not at the top of a long list.
  it("returns to the previous offset when going back", async () => {
    const user = userEvent.setup();
    renderApp();
    await scrollPageTo(640);

    await user.click(screen.getByText("go b"));
    await scrollPageTo(120);

    scrollTo.mockClear();
    await user.click(screen.getByText("back"));

    expect(screen.getByText("page a")).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 640));
  });

  it("goes to the top on back when the entry was never scrolled", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByText("go b"));
    await scrollPageTo(300);

    scrollTo.mockClear();
    await user.click(screen.getByText("back"));

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("takes scroll restoration off the browser while mounted", () => {
    const { unmount } = renderApp();
    expect(window.history.scrollRestoration).toBe("manual");
    unmount();
    expect(window.history.scrollRestoration).toBe("auto");
  });

  it("leaves a browser without scrollRestoration alone", () => {
    define("scrollRestoration", undefined, window.history);
    expect(() => renderApp()).not.toThrow();
    expect(window.history.scrollRestoration).toBeUndefined();
  });
});
