import React, { useState } from "react";
import { act, render, renderHook } from "@testing-library/react";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { useMainShellRouting } from "./useMainShellRouting";

// The tab order + feature-switch behavior of the main shell's router glue.
// Feature toggles (team.disabledFeatures, set in Settings) remove a module's
// tab for the whole staff and bounce an active/deep-linked tab back home.

const baseArgs = (over: any = {}) => ({
  activeTab: "home",
  setActiveTab: jest.fn(),
  inGameId: null,
  setInGameId: jest.fn(),
  selectedGameId: null,
  setSelectedGameId: jest.fn(),
  isAssistant: false,
  location: { pathname: "/" },
  navigate: jest.fn(),
  ...over,
});

describe("useMainShellRouting — feature switches", () => {
  it("includes every module by default (head)", () => {
    const { result } = renderHook(() => useMainShellRouting(baseArgs()));
    expect(result.current.tabOrder).toEqual([
      "home",
      "roster",
      "schedule",
      "practices",
      "stats",
      "depthChart",
      "tryouts",
      // One entry for the three parent-form inboxes.
      "families",
      "evaluation",
      "finances",
      "settings",
    ]);
  });

  it("drops Families only when all three parent inboxes are off", () => {
    const some = renderHook(() =>
      useMainShellRouting(baseArgs({ disabledFeatures: ["interest"] })),
    );
    expect(some.result.current.tabOrder).toContain("families");
    const all = renderHook(() =>
      useMainShellRouting(
        baseArgs({
          disabledFeatures: ["interest", "playerInfo", "availability"],
        }),
      ),
    );
    expect(all.result.current.tabOrder).not.toContain("families");
  });

  it("drops disabled features from the tab order for head AND assistant", () => {
    const disabled = ["tryouts", "finances", "practices"];
    const head = renderHook(() =>
      useMainShellRouting(baseArgs({ disabledFeatures: disabled })),
    );
    expect(head.result.current.tabOrder).toEqual([
      "home",
      "roster",
      "schedule",
      "stats",
      "depthChart",
      "families",
      "evaluation",
      "settings",
    ]);
    const assistant = renderHook(() =>
      useMainShellRouting(
        baseArgs({ isAssistant: true, disabledFeatures: disabled }),
      ),
    );
    expect(assistant.result.current.tabOrder).toEqual([
      "home",
      "roster",
      "schedule",
      "stats",
      "depthChart",
      "evaluation",
    ]);
  });

  it("bounces an active tab home when its feature is off (deep link / mid-session switch)", () => {
    const setActiveTab = jest.fn();
    renderHook(() =>
      useMainShellRouting(
        baseArgs({
          activeTab: "finances",
          setActiveTab,
          disabledFeatures: ["finances"],
          location: { pathname: "/finances" },
        }),
      ),
    );
    expect(setActiveTab).toHaveBeenCalledWith("home");
  });

  it("leaves an enabled active tab alone", () => {
    const setActiveTab = jest.fn();
    renderHook(() =>
      useMainShellRouting(
        baseArgs({
          activeTab: "finances",
          setActiveTab,
          disabledFeatures: ["tryouts"],
          location: { pathname: "/finances" },
        }),
      ),
    );
    expect(setActiveTab).not.toHaveBeenCalledWith("home");
  });
});

describe("useMainShellRouting — standalone (non-tab) pages", () => {
  it("maps hyphenated tab segments through the derived map", () => {
    const setActiveTab = jest.fn();
    renderHook(() =>
      useMainShellRouting(
        baseArgs({ setActiveTab, location: { pathname: "/depth-chart" } }),
      ),
    );
    expect(setActiveTab).toHaveBeenCalledWith("depthChart");
  });

  it("yields a phantom id for a standalone page without feature-bouncing it", () => {
    const setActiveTab = jest.fn();
    renderHook(() =>
      useMainShellRouting(
        baseArgs({
          activeTab: "season-report",
          setActiveTab,
          // Every feature off — a phantom id must still never bounce home.
          disabledFeatures: ["stats", "practices", "tryouts", "finances"],
          location: { pathname: "/season-report" },
        }),
      ),
    );
    expect(setActiveTab).not.toHaveBeenCalledWith("home");
  });

  it("never navigates away from a standalone page (phantom id has no tab path)", () => {
    const navigate = jest.fn();
    renderHook(() =>
      useMainShellRouting(
        baseArgs({
          activeTab: "help",
          navigate,
          location: { pathname: "/help/lineup-generator" },
        }),
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});

// The hook wired the way MainShell wires it: real state, a real router. The
// mock-args tests above can't see a navigation loop — it only exists once
// setActiveTab and navigate feed back into the next render.
const mountShell = (
  initialPath: string,
  { isAssistant = false }: { isAssistant?: boolean } = {},
) => {
  const navigations: string[] = [];
  const shell: {
    pathname: string;
    activeTab: string;
    inGameId: string | null;
    selectedGameId: string | null;
    setActiveTab: (tab: string) => void;
    setInGameId: (id: string | null) => void;
    setSelectedGameId: (id: string | null) => void;
  } = {} as never;
  const Shell = () => {
    const [activeTab, setActiveTab] = useState("home");
    const [inGameId, setInGameId] = useState<string | null>(null);
    const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
    const location = useLocation();
    const routerNavigate = useNavigate();
    const navigate = (path: string) => {
      navigations.push(path);
      if (navigations.length > 25) throw new Error("navigation loop");
      routerNavigate(path);
    };
    useMainShellRouting({
      activeTab,
      setActiveTab,
      inGameId,
      setInGameId,
      selectedGameId,
      setSelectedGameId,
      isAssistant,
      location,
      navigate,
    });
    Object.assign(shell, {
      pathname: location.pathname,
      activeTab,
      inGameId,
      selectedGameId,
      setActiveTab,
      setInGameId,
      setSelectedGameId,
    });
    return (
      <Routes>
        {/* The same guard App.tsx puts on the head-only routes. */}
        <Route
          path="/settings"
          element={isAssistant ? <Navigate to="/" replace /> : null}
        />
        <Route path="*" element={null} />
      </Routes>
    );
  };
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Shell />
    </MemoryRouter>,
  );
  return { shell, navigations };
};

describe("useMainShellRouting — opening the app on a page (refresh / deep link)", () => {
  it.each([
    ["/roster", "roster"],
    ["/roster/ada-lovelace", "roster"],
    ["/stats/trends", "stats"],
    ["/depth-chart", "depthChart"],
    ["/settings", "settings"],
  ])("stays on %s and lights its tab", (path, tab) => {
    const { shell, navigations } = mountShell(path);
    expect(shell.pathname).toBe(path);
    expect(shell.activeTab).toBe(tab);
    expect(navigations).toEqual([]);
  });

  it.each(["/help", "/help/lineup-generator", "/season-report", "/awards"])(
    "stays on the standalone page %s",
    (path) => {
      const { shell, navigations } = mountShell(path);
      expect(shell.pathname).toBe(path);
      expect(navigations).toEqual([]);
    },
  );

  it("stays on the game editor and selects its game", () => {
    const { shell, navigations } = mountShell("/schedule/game/g1");
    expect(shell.pathname).toBe("/schedule/game/g1");
    expect(shell.selectedGameId).toBe("g1");
    expect(shell.activeTab).toBe("schedule");
    expect(navigations).toEqual([]);
  });

  it("stays on the live game and resumes it", () => {
    const { shell, navigations } = mountShell("/in-game/g1");
    expect(shell.pathname).toBe("/in-game/g1");
    expect(shell.inGameId).toBe("g1");
    expect(shell.activeTab).toBe("schedule");
    expect(navigations).toEqual([]);
  });

  it("settles on Home when an assistant opens a head-only page", () => {
    const { shell, navigations } = mountShell("/settings", {
      isAssistant: true,
    });
    expect(shell.pathname).toBe("/");
    expect(shell.activeTab).toBe("home");
    expect(navigations).toEqual([]);
  });
});

describe("useMainShellRouting — state still drives the URL after mount", () => {
  it("navigates when the tab changes", () => {
    const { shell, navigations } = mountShell("/roster/ada-lovelace");
    act(() => shell.setActiveTab("schedule"));
    expect(shell.pathname).toBe("/schedule");
    expect(navigations).toEqual(["/schedule"]);
    // Same top-level section: a tab the URL already shows is left alone.
    act(() => shell.setActiveTab("home"));
    expect(shell.pathname).toBe("/");
  });

  it("opens and closes the game editor", () => {
    const { shell } = mountShell("/schedule");
    act(() => shell.setSelectedGameId("g2"));
    expect(shell.pathname).toBe("/schedule/game/g2");
    act(() => shell.setSelectedGameId(null));
    expect(shell.pathname).toBe("/schedule");
  });

  it("enters and leaves the live game", () => {
    const { shell } = mountShell("/schedule/game/g2");
    act(() => shell.setInGameId("g2"));
    expect(shell.pathname).toBe("/in-game/g2");
    expect(shell.selectedGameId).toBeNull();
    act(() => shell.setInGameId(null));
    expect(shell.pathname).toBe("/schedule");
    expect(shell.inGameId).toBeNull();
  });
});
