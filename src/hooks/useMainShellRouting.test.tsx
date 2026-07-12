import { renderHook } from "@testing-library/react";
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
      "interest",
      "playerInfo",
      "availability",
      "evaluation",
      "finances",
      "settings",
    ]);
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
      "interest",
      "playerInfo",
      "availability",
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
