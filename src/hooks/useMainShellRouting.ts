import { useEffect, useMemo } from "react";

const TAB_TO_PATH: Record<string, string> = {
  home: "/",
  schedule: "/schedule",
  roster: "/roster",
  depthChart: "/depth-chart",
  evaluation: "/evaluation",
  tryouts: "/tryouts",
  interest: "/interest",
  settings: "/settings",
};

const pathToTab = (pathname: string): string => {
  if (!pathname || pathname === "/") return "home";
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "in-game") return "schedule";
  if (first === "depth-chart") return "depthChart";
  return first || "home";
};

interface UseMainShellRoutingArgs {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  inGameId: string | null;
  setInGameId: (id: string | null) => void;
  isAssistant: boolean;
  tryoutsOpen: boolean;
  location: { pathname: string };
  navigate: (path: string) => void;
}

export const useMainShellRouting = ({
  activeTab,
  setActiveTab,
  inGameId,
  setInGameId,
  isAssistant,
  tryoutsOpen,
  location,
  navigate,
}: UseMainShellRoutingArgs) => {
  const tabOrder = useMemo(
    () =>
      isAssistant
        ? tryoutsOpen
          ? ["home", "schedule", "roster", "depthChart", "tryouts", "evaluation"]
          : ["home", "schedule", "roster", "depthChart", "evaluation"]
        : tryoutsOpen
        ? ["home", "schedule", "roster", "depthChart", "tryouts", "evaluation", "settings"]
        : ["home", "schedule", "roster", "depthChart", "evaluation", "settings"],
    [isAssistant, tryoutsOpen]
  );

  useEffect(() => {
    if (!isAssistant) return;
    if (activeTab === "settings") setActiveTab("home");
  }, [isAssistant, activeTab, setActiveTab]);

  useEffect(() => {
    const tabFromUrl = pathToTab(location.pathname);
    if (tabFromUrl !== activeTab) setActiveTab(tabFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname.startsWith("/in-game/")) return;
    const target = TAB_TO_PATH[activeTab];
    if (target == null) return;
    const path = target || "/";
    const currentTopLevel = "/" + (location.pathname.split("/")[1] || "");
    const targetTopLevel = "/" + (path.split("/")[1] || "");
    if (currentTopLevel !== targetTopLevel) navigate(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (inGameId) {
      if (!location.pathname.startsWith(`/in-game/${inGameId}`)) {
        navigate(`/in-game/${inGameId}`);
      }
    } else if (location.pathname.startsWith("/in-game/")) {
      navigate("/schedule");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inGameId]);

  useEffect(() => {
    const match = location.pathname.match(/^\/in-game\/([^/]+)/);
    if (match && match[1] !== inGameId) setInGameId(match[1]);
    else if (!match && inGameId) setInGameId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return { tabOrder };
};
