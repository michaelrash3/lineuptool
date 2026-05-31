import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { isGameFinalized } from "../utils/helpers";

// Lightweight fuzzy match: case-insensitive substring score. Returns -1 if
// the query has zero characters present in the candidate; otherwise lower
// is better (matched index of the query inside the haystack).
const fuzzyScore = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  const h = (haystack || "").toLowerCase();
  const n = needle.toLowerCase();
  const idx = h.indexOf(n);
  if (idx !== -1) return idx;
  // Tokenized fallback: every needle char must appear in order somewhere.
  let cursor = 0;
  let score = 0;
  for (const ch of n) {
    const at = h.indexOf(ch, cursor);
    if (at === -1) return -1;
    score += at - cursor + 1;
    cursor = at + 1;
  }
  // Loose matches score worse than substring hits.
  return score + 1000;
};

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export const CommandPalette = ({ open, onClose }: CommandPaletteProps) => {
  const { team, currentRole } = useTeam();
  const isAssistant = currentRole === "assistant";
  const {
    setActiveTab,
    openPlayerProfile,
    setSelectedGameId,
    setIsAddingPlayer,
    setAssistantEvalOpen,
  } = useUI();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset every time the palette opens fresh.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Defer focus until the input has mounted.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Build the candidate list from team data.
  const allItems = useMemo(() => {
    if (!team) return [];
    const items = [];
    const players = team.players || [];
    const games = team.games || [];

    for (const p of players) {
      items.push({
        kind: "player",
        id: `player:${p.id}`,
        label: p.name || "Unnamed",
        sublabel: `#${p.number || "—"} · ${p.primaryPosition || "any"}${
          p.present === false ? " · absent" : ""
        }`,
        searchKey: `${p.name} ${p.number || ""} ${p.primaryPosition || ""}`,
        action: () => openPlayerProfile(p.id),
      });
    }

    for (const g of games) {
      const date = g.date || "";
      items.push({
        kind: "game",
        id: `game:${g.id}`,
        label: `vs ${g.opponent || "Game"}`,
        sublabel: `${date}${isGameFinalized(g) ? " · final" : ""}`,
        searchKey: `${g.opponent || ""} ${date}`,
        action: () => {
          setActiveTab("schedule");
          setSelectedGameId(g.id);
        },
      });
    }

    items.push(
      {
        kind: "nav",
        id: "nav:home",
        label: "Home",
        sublabel: "Dashboard",
        searchKey: "home dashboard",
        action: () => setActiveTab("home"),
      },
      {
        kind: "nav",
        id: "nav:roster",
        label: "Roster",
        sublabel: "Team Roster",
        searchKey: "roster players team",
        action: () => setActiveTab("roster"),
      },
      {
        kind: "nav",
        id: "nav:schedule",
        label: "Schedule",
        sublabel: "Games",
        searchKey: "schedule games",
        action: () => setActiveTab("schedule"),
      }
    );
    if (!isAssistant) {
      items.push(
        {
          kind: "nav",
          id: "nav:evaluation",
          label: "Evaluation",
          sublabel: "Player evals",
          searchKey: "evaluation grades trends",
          action: () => setActiveTab("evaluation"),
        },
        {
          kind: "nav",
          id: "nav:settings",
          label: "Settings",
          sublabel: "Team settings",
          searchKey: "settings preferences",
          action: () => setActiveTab("settings"),
        },
        {
          kind: "action",
          id: "action:add-player",
          label: "Add Player",
          sublabel: "Create a new roster entry",
          searchKey: "add player new roster",
          action: () => {
            setActiveTab("roster");
            setIsAddingPlayer(true);
          },
        }
      );
    } else {
      items.push({
        kind: "action",
        id: "action:submit-eval",
        label: "Submit Evaluation",
        sublabel: "Send your grades to the head coach",
        searchKey: "submit eval evaluation grades",
        action: () => setAssistantEvalOpen(true),
      });
    }

    return items;
  }, [
    team,
    isAssistant,
    openPlayerProfile,
    setActiveTab,
    setSelectedGameId,
    setIsAddingPlayer,
    setAssistantEvalOpen,
  ]);

  const results = useMemo(() => {
    if (!query.trim()) {
      // No query: show navigation + actions first, then a sampling of players.
      const navAndActions = allItems.filter(
        (i) => i.kind === "nav" || i.kind === "action"
      );
      const players = allItems.filter((i) => i.kind === "player").slice(0, 8);
      const games = allItems.filter((i) => i.kind === "game").slice(0, 4);
      return [...navAndActions, ...games, ...players];
    }
    const scored = allItems
      .map((item) => ({ item, score: fuzzyScore(item.searchKey, query) }))
      .filter((r) => r.score !== -1)
      .sort((a, b) => a.score - b.score)
      .slice(0, 12)
      .map((r) => r.item);
    return scored;
  }, [allItems, query]);

  // Keep activeIdx in bounds when results shrink.
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  // Scroll the active row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-cp-row="${activeIdx}"]`
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  const selectActive = useCallback(() => {
    const item = results[activeIdx];
    if (!item) return;
    item.action();
    onClose();
  }, [results, activeIdx, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[140] bg-slate-900/60 backdrop-blur-sm p-4 flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface w-full max-w-xl rounded-2xl shadow-2xl border border-line overflow-hidden flex flex-col max-h-[70vh]"
      >
        <div
          className="h-1.5"
          style={{ backgroundColor: "var(--team-primary)" }}
        />
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <Icons.Forward className="w-4 h-4 text-ink-3" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search players, games, actions…"
            aria-label="Command palette search"
            className="flex-1 text-sm font-bold text-ink outline-none bg-transparent"
          />
          <span className="t-eyebrow text-ink-3 hidden sm:inline">Esc</span>
        </div>
        <div ref={listRef} className="overflow-y-auto flex-1 py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center t-body text-ink-3">
              No matches.
            </div>
          ) : (
            results.map((item, i) => {
              const isActive = i === activeIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-cp-row={i}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                    isActive ? "bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <span
                    className="t-chip px-2 py-1 rounded-md shrink-0"
                    style={{
                      backgroundColor: "var(--team-primary-15)",
                      color: "var(--team-primary)",
                    }}
                  >
                    {item.kind === "player"
                      ? "Player"
                      : item.kind === "game"
                      ? "Game"
                      : item.kind === "nav"
                      ? "Tab"
                      : "Action"}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block t-body-bold truncate text-ink">
                      {item.label}
                    </span>
                    <span className="block text-[11px] font-medium text-ink-3 truncate">
                      {item.sublabel}
                    </span>
                  </span>
                  {isActive && (
                    <Icons.ChevronRight className="w-4 h-4 text-ink-3 shrink-0" />
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-2.5 bg-app border-t border-line flex items-center justify-between text-[10px] font-bold text-ink-3 uppercase tracking-widest">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
};
