import { useEffect, useMemo } from "react";

const TAB_TO_PATH: Record<string, string> = {
  home: "/",
  schedule: "/schedule",
  practices: "/practices",
  roster: "/roster",
  stats: "/stats",
  depthChart: "/depth-chart",
  evaluation: "/evaluation",
  tryouts: "/tryouts",
  interest: "/interest",
  playerInfo: "/player-info",
  availability: "/availability",
  finances: "/finances",
  settings: "/settings",
};

const pathToTab = (pathname: string): string => {
  if (!pathname || pathname === "/") return "home";
  const first = pathname.split("/").filter(Boolean)[0];
  if (first === "in-game") return "schedule";
  if (first === "depth-chart") return "depthChart";
  if (first === "player-info") return "playerInfo";
  if (first === "availability") return "availability";
  return first || "home";
};

interface UseMainShellRoutingArgs {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  inGameId: string | null;
  setInGameId: (id: string | null) => void;
  selectedGameId: string | null;
  setSelectedGameId: (id: string | null) => void;
  isAssistant: boolean;
  location: { pathname: string };
  navigate: (path: string) => void;
}

export const useMainShellRouting = ({
  activeTab,
  setActiveTab,
  inGameId,
  setInGameId,
  selectedGameId,
  setSelectedGameId,
  isAssistant,
  location,
  navigate,
}: UseMainShellRoutingArgs) => {
  // Tryouts is a standing destination — always in the order. `tryoutsOpen`
  // only governs whether the PUBLIC form accepts submissions, never whether a
  // coach can reach the tab (dates, share links, and intake controls live
  // there year-round).
  const tabOrder = useMemo(
    () =>
      isAssistant
        ? [
            "home",
            "roster",
            "schedule",
            "practices",
            "stats",
            "depthChart",
            "tryouts",
            "evaluation",
          ]
        : [
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
          ],
    [isAssistant],
  );

  useEffect(() => {
    if (!isAssistant) return;
    if (activeTab === "settings" || activeTab === "finances")
      setActiveTab("home");
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

  // The full-screen game editor (selectedGameId) is URL-backed at
  // /schedule/game/:id, the same contract as inGameId above. This makes the
  // editor a real page: the browser/Android back button closes it, it's
  // deep-linkable, and a refresh keeps you on it. Every place that opens a
  // game still just calls setSelectedGameId(id) — these effects mirror that
  // selection into the URL (and vice-versa) with no per-call-site changes.
  // In-game takes precedence, so don't fight its route while it's active.
  useEffect(() => {
    if (location.pathname.startsWith("/in-game/")) return;
    if (selectedGameId) {
      if (!location.pathname.startsWith(`/schedule/game/${selectedGameId}`)) {
        navigate(`/schedule/game/${selectedGameId}`);
      }
    } else if (location.pathname.startsWith("/schedule/game/")) {
      navigate("/schedule");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGameId]);

  useEffect(() => {
    const match = location.pathname.match(/^\/schedule\/game\/([^/]+)/);
    if (match && match[1] !== selectedGameId) setSelectedGameId(match[1]);
    else if (!match && selectedGameId) setSelectedGameId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return { tabOrder };
};
