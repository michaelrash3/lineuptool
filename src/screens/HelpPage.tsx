import React, { useEffect, useMemo, useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { Button, Eyebrow } from "../components/shared";
import { PageShell } from "../components/PageShell";
import { useBackOrFallback } from "../hooks/usePageNav";
import {
  HELP_CATEGORIES,
  TAB_TO_HELP_CATEGORY,
  searchHelpTopics,
  visibleHelpTopics,
  type HelpCategoryId,
  type HelpCta,
  type HelpTopic,
} from "../help/content";
import { getCompletedTours, markTourComplete } from "../help/helpPrefs";
import { getLocalDateString } from "../constants/ui";
import { visibleTours, type Tour } from "../help/tours";
import {
  attachStepNumbers,
  TourModal,
  type TourCtaCtx,
} from "../components/help/TourModal";

// Help & Tutorials as a routed page — /help browses by category, /help/:topicId
// reads one article (deep-linkable, refresh-safe, back-button friendly).
// Converted from the HelpCenter overlay per the app-wide modals→pages rule.
// Guided tours remain an overlay (TourModal) — tours are an approved
// exception: they exist to point at the UI underneath them.

const CATEGORY_LABELS = new Map<string, string>(
  HELP_CATEGORIES.map((c) => [c.id, c.label]),
);
const labelFor = (id: string) => CATEGORY_LABELS.get(id) || id;

export const HelpPage = ({
  onOpenTutorial,
}: {
  onOpenTutorial: () => void;
}) => {
  const { team, currentRole } = useTeam();
  const { setActiveTab, setIsAddingPlayer, setIsAddingGame } = useUI();
  const { topicId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const back = useBackOrFallback("/");

  const [query, setQuery] = useState("");
  // Callers pass the tab they came from via navigation state so the browse
  // view opens on a contextual category ("?" on the Roster tab lands on
  // Roster help); a cold deep link starts at Getting Started.
  const [categoryId, setCategoryId] = useState<HelpCategoryId>(() => {
    const from = (location.state as { from?: string } | null)?.from;
    return (from && TAB_TO_HELP_CATEGORY[from]) || "getting-started";
  });
  const [activeTour, setActiveTour] = useState<Tour | null>(null);
  const [completedTours, setCompletedTours] = useState<string[]>(() =>
    getCompletedTours(),
  );
  // Mobile is single-pane: false shows the rail, true the topic/article pane.
  const [mobileContent, setMobileContent] = useState(false);

  const topics = useMemo(
    () => visibleHelpTopics(team, currentRole),
    [team, currentRole],
  );
  const tours = useMemo(
    () => visibleTours(team, currentRole),
    [team, currentRole],
  );
  const categories = useMemo(
    () =>
      HELP_CATEGORIES.filter((c) => topics.some((t) => t.category === c.id)),
    [topics],
  );

  // The URL owns the article. Keep the rail's category in step with it so
  // landing on /help/:topicId highlights (and back-navigates to) the right
  // category.
  const activeTopic = topicId
    ? topics.find((t) => t.id === topicId)
    : undefined;
  useEffect(() => {
    if (activeTopic) {
      setCategoryId(activeTopic.category);
      setMobileContent(true);
    }
  }, [activeTopic]);

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchHelpTopics(topics, query) : []),
    [searching, topics, query],
  );

  const tourCtx = useMemo<TourCtaCtx>(() => {
    // Local calendar day, not UTC — an evening game must still count as
    // "today" for the game-day CTA.
    const today = getLocalDateString();
    const games = team?.games || [];
    // Add-flows are head-coach actions (their editors are role-gated at the
    // destination); assistant CTAs still navigate but skip the editor flag.
    const isAssistant = currentRole === "assistant";
    return {
      hasPlayers: (team?.players || []).length > 0,
      hasGames: games.length > 0,
      hasGameToday: games.some(
        (g: any) =>
          g.date === today && g.status !== "final" && g.status !== "postponed",
      ),
      setActiveTab,
      setIsAddingPlayer: isAssistant ? () => {} : setIsAddingPlayer,
      setIsAddingGame: isAssistant ? () => {} : setIsAddingGame,
    };
  }, [team, currentRole, setActiveTab, setIsAddingPlayer, setIsAddingGame]);

  const tourSteps = useMemo(
    () => (activeTour ? attachStepNumbers(activeTour.buildSteps(tourCtx)) : []),
    [activeTour, tourCtx],
  );

  // A dead or role-hidden article link lands on the browse view instead of a
  // blank page.
  if (topicId && !activeTopic) {
    return <Navigate to="/help" replace />;
  }

  const category = HELP_CATEGORIES.find((c) => c.id === categoryId);
  const categoryTopics = topics.filter((t) => t.category === categoryId);
  const showContent = mobileContent || searching || !!activeTopic;

  const openCategory = (id: HelpCategoryId) => {
    setCategoryId(id);
    setQuery("");
    setMobileContent(true);
    // Reading an article? The category tap returns to browse.
    if (topicId) navigate("/help");
  };

  const openTopic = (t: HelpTopic) => {
    setQuery("");
    navigate(`/help/${t.id}`);
  };

  const runCta = (cta: HelpCta) => {
    // setActiveTab routes to the tab (useMainShellRouting mirrors it), so
    // the CTA is itself the navigation away from Help.
    setActiveTab(cta.tab);
    // Add-flows are head-coach actions (AddPlayerModal / ScheduleTab both
    // role-gate their editors); for assistants the CTA just navigates.
    if (currentRole !== "assistant") {
      if (cta.uiAction === "addPlayer") setIsAddingPlayer(true);
      if (cta.uiAction === "addGame") setIsAddingGame(true);
    }
  };

  const goBack = () => {
    if (searching) setQuery("");
    else if (topicId) navigate("/help");
    else setMobileContent(false);
  };

  const topicRow = (t: HelpTopic, eyebrow?: string) => (
    <button
      key={t.id}
      type="button"
      data-help-result={searching || undefined}
      onClick={() => openTopic(t)}
      className="w-full text-left px-5 py-3 min-h-[44px] border-b border-line hover:bg-surface-2 transition-colors"
    >
      {eyebrow && <Eyebrow className="block mb-0.5">{eyebrow}</Eyebrow>}
      <span className="block t-body-bold text-ink">{t.title}</span>
      <span className="block t-meta text-ink-3 mt-0.5">{t.summary}</span>
    </button>
  );

  let content: React.ReactNode;
  if (searching) {
    content =
      results.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
          <Icons.Search className="w-8 h-8 text-ink-3 mb-3" />
          <p className="t-body-bold text-ink mb-1">No matching articles</p>
          <p className="t-body text-ink-3">
            Try different words, or browse a category instead.
          </p>
        </div>
      ) : (
        <div>{results.map((t) => topicRow(t, labelFor(t.category)))}</div>
      );
  } else if (activeTopic) {
    const related = (activeTopic.related || [])
      .map((id) => topics.find((t) => t.id === id))
      .filter((t): t is HelpTopic => !!t);
    content = (
      <div className="px-5 py-4">
        <div className="flex items-center gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => navigate("/help")}
            className="t-eyebrow text-ink-3 hover:text-ink transition-colors"
          >
            {labelFor(activeTopic.category)}
          </button>
          <span className="t-eyebrow text-ink-3" aria-hidden>
            ›
          </span>
          <span className="t-eyebrow" style={{ color: "var(--team-ink)" }}>
            {activeTopic.title}
          </span>
        </div>
        <h3 className="t-card-title mb-1.5">{activeTopic.title}</h3>
        <p className="t-body text-ink-2 mb-5">{activeTopic.summary}</p>
        <div className="space-y-4">
          {activeTopic.sections.map((s, i) => (
            <div key={i}>
              {s.heading && (
                <h4 className="t-body-bold text-ink mb-1">{s.heading}</h4>
              )}
              <p className="t-body leading-relaxed">{s.body}</p>
              {s.list && (
                <ul className="mt-2 space-y-1.5 list-disc pl-5">
                  {s.list.map((item, j) => (
                    <li key={j} className="t-body leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        {related.length > 0 && (
          <div className="mt-6">
            <Eyebrow className="block mb-2">Related</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {related.map((rt) => (
                <button
                  key={rt.id}
                  type="button"
                  onClick={() => openTopic(rt)}
                  className="t-chip px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-80"
                  style={{
                    backgroundColor: "var(--team-primary-15)",
                    color: "var(--team-ink)",
                  }}
                >
                  {rt.title}
                </button>
              ))}
            </div>
          </div>
        )}
        {activeTopic.cta && (
          <div className="mt-6">
            <Button onClick={() => runCta(activeTopic.cta!)}>
              {activeTopic.cta.label}
              <Icons.ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    );
  } else {
    content = (
      <div>
        <div className="px-5 pt-4 pb-3 border-b border-line">
          <h3 className="t-card-title">{category?.label}</h3>
          <p className="t-meta text-ink-3 mt-0.5">{category?.blurb}</p>
        </div>
        {categoryTopics.map((t) => topicRow(t))}
      </div>
    );
  }

  return (
    <PageShell eyebrow="Help" title="Help & Tutorials" onBack={back}>
      {/* While a tour runs, the tour modal overlays the page and points at
          the UI it walks through; Skip/X/Escape/Done land back here. */}
      {activeTour && (
        <TourModal
          open
          steps={tourSteps}
          onComplete={() => {
            markTourComplete(activeTour.id);
            setCompletedTours(getCompletedTours());
          }}
          onClose={() => setActiveTour(null)}
          onCtaNavigate={() => setActiveTour(null)}
        />
      )}

      <div className="cc-card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-3">
          <Icons.Book
            className="w-5 h-5 shrink-0"
            style={{ color: "var(--team-ink)" }}
          />
          <div className="flex-1 min-w-0 flex items-center gap-2 bg-surface-2 border border-line rounded-xl px-3 py-2">
            <Icons.Search className="w-4 h-4 text-ink-3 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help…"
              aria-label="Search help articles"
              className="flex-1 min-w-0 text-sm font-bold text-ink outline-none bg-transparent placeholder:text-ink-3"
            />
          </div>
        </div>
        <div className="flex min-h-[50vh]">
          <div
            className={`${
              showContent ? "hidden sm:flex" : "flex"
            } w-full sm:w-60 shrink-0 flex-col overflow-y-auto sm:border-r border-line bg-app py-3`}
          >
            <Eyebrow className="block px-4 mb-1.5">Guided Tours</Eyebrow>
            <button
              type="button"
              onClick={onOpenTutorial}
              className="w-full text-left px-4 py-2 min-h-[40px] flex items-center gap-2.5 hover:bg-surface-2 transition-colors"
            >
              <Icons.HomePlate
                className="w-4 h-4 shrink-0"
                style={{ color: "var(--team-ink)" }}
              />
              <span className="t-body-bold text-ink">
                Replay the orientation
              </span>
            </button>
            {tours.map((tour) => {
              const TourIcon = tour.icon;
              const done = completedTours.includes(tour.id);
              return (
                <button
                  key={tour.id}
                  type="button"
                  onClick={() => setActiveTour(tour)}
                  className="w-full text-left px-4 py-2 min-h-[40px] flex items-center gap-2.5 hover:bg-surface-2 transition-colors"
                >
                  <TourIcon
                    className="w-4 h-4 shrink-0"
                    style={{ color: "var(--team-ink)" }}
                  />
                  <span className="t-body-bold text-ink flex-1 min-w-0">
                    {tour.title}
                  </span>
                  {done && (
                    <span
                      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full"
                      style={{
                        backgroundColor: "var(--team-primary-15)",
                        color: "var(--team-ink)",
                      }}
                    >
                      <Icons.Check className="w-3 h-3" />
                      <span className="sr-only">Completed</span>
                    </span>
                  )}
                </button>
              );
            })}
            <Eyebrow className="block px-4 mt-5 mb-1.5">Browse</Eyebrow>
            {categories.map((c) => {
              const CatIcon = Icons[c.icon] || Icons.Book;
              const selected = !searching && c.id === categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openCategory(c.id)}
                  aria-current={selected || undefined}
                  className={`w-full text-left px-4 py-2 min-h-[40px] flex items-center gap-2.5 transition-colors ${
                    selected ? "" : "hover:bg-surface-2"
                  }`}
                  style={
                    selected
                      ? { backgroundColor: "var(--team-primary-15)" }
                      : undefined
                  }
                >
                  <CatIcon
                    className={`w-4 h-4 shrink-0 ${selected ? "" : "text-ink-3"}`}
                    style={selected ? { color: "var(--team-ink)" } : undefined}
                  />
                  <span
                    className={`t-body-bold ${selected ? "" : "text-ink-2"}`}
                    style={selected ? { color: "var(--team-ink)" } : undefined}
                  >
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>
          <div
            className={`${
              showContent ? "flex" : "hidden sm:flex"
            } flex-1 min-w-0 flex-col overflow-y-auto`}
          >
            <button
              type="button"
              onClick={goBack}
              aria-label="Back to browse"
              className="sm:hidden shrink-0 w-full text-left px-4 py-2.5 flex items-center gap-1.5 t-eyebrow text-ink-3 hover:text-ink border-b border-line transition-colors"
            >
              <Icons.ChevronLeft className="w-4 h-4" /> Back
            </button>
            {content}
          </div>
        </div>
      </div>
    </PageShell>
  );
};
