import { useEffect, useMemo } from "react";
import { featureEnabled } from "../constants/features";

// Exported for help-content integrity tests (every help CTA must target a
// real tab) — routing behavior itself only uses it internally.
export const TAB_TO_PATH: Record<string, string> = {
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
  // The team's Settings-driven feature switches (team.disabledFeatures).
  // Absent/empty = every module on.
  disabledFeatures?: string[];
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
  disabledFeatures,
  location,
  navigate,
}: UseMainShellRoutingArgs) => {
  // Tryouts is a standing destination — in the order unless the head turned
  // the feature off. `tryoutsOpen` only governs whether the PUBLIC form
  // accepts submissions, never whether a coach can reach the tab (dates,
  // share links, and intake controls live there year-round).
  const tabOrder = useMemo(() => {
    const team = { disabledFeatures };
    const order = isAssistant
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
        ];
    return order.filter((t) => featureEnabled(team, t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssistant, (disabledFeatures || []).join(",")]);

  useEffect(() => {
    if (!isAssistant) return;
    if (activeTab === "settings" || activeTab === "finances")
      setActiveTab("home");
  }, [isAssistant, activeTab, setActiveTab]);

  // A tab whose feature was switched off (or a direct URL into one) bounces
  // home — the same treatment as the assistant gate above.
  useEffect(() => {
    if (activeTab === "home") return;
    if (!featureEnabled({ disabledFeatures }, activeTab)) setActiveTab("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, (disabledFeatures || []).join(","), setActiveTab]);

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
