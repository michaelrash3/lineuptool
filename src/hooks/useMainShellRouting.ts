import { useEffect, useMemo, useRef } from "react";
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
  families: "/families",
  interest: "/interest",
  playerInfo: "/player-info",
  availability: "/availability",
  finances: "/finances",
  settings: "/settings",
};

// First URL segment → tab id, derived from TAB_TO_PATH so the two maps can
// never drift (e.g. depth-chart → depthChart, player-info → playerInfo).
const SEGMENT_TO_TAB: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_TO_PATH).map(([tab, path]) => [
    path.split("/")[1] || "",
    tab,
  ]),
);

const pathToTab = (pathname: string): string => {
  const first = pathname.split("/").filter(Boolean)[0];
  if (!first) return "home";
  // The live game is schedule work — it rides the schedule tab.
  if (first === "in-game") return "schedule";
  // Standalone pages with no tab of their own (/help, /season-report,
  // /awards, /welcome, …) yield their segment as a PHANTOM tab id: it
  // matches no nav button (nothing highlights) and the effects below
  // explicitly skip non-tab ids rather than forcing a navigation.
  return SEGMENT_TO_TAB[first] || first;
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
          "families",
          "evaluation",
          "finances",
          "settings",
        ];
    // "families" groups three toggleable inboxes — it's in the order while
    // any of them is on.
    const familiesOn = ["interest", "playerInfo", "availability"].some((id) =>
      featureEnabled(team, id),
    );
    return order.filter((t) =>
      t === "families" ? familiesOn : featureEnabled(team, t),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAssistant, (disabledFeatures || []).join(",")]);

  useEffect(() => {
    if (!isAssistant) return;
    if (activeTab === "settings" || activeTab === "finances")
      setActiveTab("home");
  }, [isAssistant, activeTab, setActiveTab]);

  // A tab whose feature was switched off (or a direct URL into one) bounces
  // home — the same treatment as the assistant gate above. Phantom ids from
  // standalone pages are not tabs and are never feature-bounced; without this
  // guard they'd only survive because featureEnabled happens to pass unknown
  // ids today.
  useEffect(() => {
    if (activeTab === "home") return;
    if (!(activeTab in TAB_TO_PATH)) return;
    if (!featureEnabled({ disabledFeatures }, activeTab)) setActiveTab("home");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, (disabledFeatures || []).join(","), setActiveTab]);

  // The router glue is three pairs of effects — active tab, in-game, game
  // editor — each mirroring a piece of state into the URL and the URL back
  // into that state. Two rules keep a pair from fighting itself:
  //
  //  1. State → URL acts only when the state CHANGES, never on mount. On mount
  //     the state is still its default ("home" / no game) while the URL may be
  //     a refresh or a deep link; mirroring the default into the URL kicked
  //     the visitor to "/" in the same flush that URL → state adopted the real
  //     page, and the two then traded navigations forever (thousands of
  //     history pushes a second, the sub-path lost, /help and friends dumped
  //     on Home).
  //  2. A value adopted FROM the URL is never pushed back to it. URL → state
  //     records what it adopted in the pair's ref, so state → URL sees nothing
  //     new. Without this a route guard's redirect (an assistant opening
  //     /settings is replaced to "/") landing in the same flush set off the
  //     same endless trade.
  //
  // Each ref holds the value last reconciled with the URL. State → URL must
  // stay declared BEFORE its URL → state partner: it has to compare against
  // the ref as the previous commit left it. Comparing values rather than
  // counting runs keeps StrictMode's double-invoked mount effects a no-op.
  const mirroredTabRef = useRef(activeTab);
  const mirroredInGameIdRef = useRef(inGameId);
  const mirroredGameIdRef = useRef(selectedGameId);

  useEffect(() => {
    if (mirroredTabRef.current === activeTab) return;
    mirroredTabRef.current = activeTab;
    if (location.pathname.startsWith("/in-game/")) return;
    // Phantom ids have no path — the URL already IS the page; never yank the
    // user off a standalone route.
    const target = TAB_TO_PATH[activeTab];
    if (target == null) return;
    const path = target || "/";
    const currentTopLevel = "/" + (location.pathname.split("/")[1] || "");
    const targetTopLevel = "/" + (path.split("/")[1] || "");
    if (currentTopLevel !== targetTopLevel) navigate(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const tabFromUrl = pathToTab(location.pathname);
    if (tabFromUrl !== activeTab) {
      mirroredTabRef.current = tabFromUrl;
      setActiveTab(tabFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (mirroredInGameIdRef.current === inGameId) return;
    mirroredInGameIdRef.current = inGameId;
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
    const idFromUrl = match ? match[1] : null;
    if (idFromUrl !== inGameId) {
      mirroredInGameIdRef.current = idFromUrl;
      setInGameId(idFromUrl);
    }
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
    if (mirroredGameIdRef.current === selectedGameId) return;
    mirroredGameIdRef.current = selectedGameId;
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
    const idFromUrl = match ? match[1] : null;
    if (idFromUrl !== selectedGameId) {
      mirroredGameIdRef.current = idFromUrl;
      setSelectedGameId(idFromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return { tabOrder };
};
