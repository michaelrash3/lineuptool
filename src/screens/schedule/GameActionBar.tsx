import React, { useLayoutEffect, useRef, useState } from "react";
import { Icons } from "../../icons";
import { useTeam, useUI, useConfirm } from "../../contexts";
import type { Game } from "../../types";

// The fewest kids marked present that a lineup can be built from.
export const MIN_PRESENT_TO_BUILD = 7;

// The game screen's build controls, pinned to the bottom of the screen. On a
// phone the coach marks attendance near the top, and Build used to sit in a
// sideways-scrolling row up there with six other buttons, so it could scroll
// out of view. Here Build and Re-roll are always in reach; the rarer actions
// (re-roll one half, save or apply a template) fold behind More on a phone and
// show inline on wider screens.
//
// The page-wide Help button floats bottom-right, so while this bar is on
// screen it publishes its height as --bottom-bar-h and the Help button rises
// above it instead of covering More.
export const GameActionBar = ({
  game,
  presentCount,
  onLineupAction,
}: {
  game: Game;
  presentCount: number;
  // Called after any build or re-roll, so the screen can bring the new
  // lineup into view.
  onLineupAction?: () => void;
}) => {
  const {
    team,
    generateLineup,
    regenerateLineup,
    regenerateBatting,
    regenerateDefense,
    saveLineupTemplate,
    applyLineupTemplate,
    deleteLineupTemplate,
  } = useTeam();
  const { lineup } = useUI();
  const { confirm, promptText } = useConfirm();
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!el) return;
    const publish = () =>
      root.style.setProperty("--bottom-bar-h", `${el.offsetHeight + 16}px`);
    publish();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty("--bottom-bar-h");
    };
  }, []);

  const templates: any[] = team?.lineupTemplates || [];
  const hasLineup = !!lineup;
  const canBuild = presentCount >= MIN_PRESENT_TO_BUILD;
  const hasMore = hasLineup || templates.length > 0;

  // The callback goes first so the screen has marked the tap by the time the
  // new lineup lands. A More action also folds More away again.
  const run = (action?: () => unknown) => {
    onLineupAction?.();
    action?.();
    setMoreOpen(false);
  };

  const secondaryBtn =
    "shrink-0 whitespace-nowrap [&>svg]:shrink-0 min-h-[44px] py-2.5 px-3 sm:px-4 flex items-center justify-center gap-2 font-black uppercase tracking-wider transition-colors rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink";

  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Lineup actions"
      className="sticky bottom-0 z-30 print:hidden -mx-4 sm:-mx-6 lg:mx-0 lg:bottom-4 px-4 sm:px-6 lg:px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:pb-3 bg-surface/95 backdrop-blur border-t lg:border border-line lg:rounded-2xl shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
    >
      {!canBuild ? (
        <p className="text-xs font-bold text-ink-2 py-2">
          Mark at least {MIN_PRESENT_TO_BUILD} players here to build a lineup
          {" — "}
          {presentCount} so far.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => run(() => generateLineup())}
            className="btn-premium flex-1 sm:flex-none whitespace-nowrap min-h-[44px] py-3 px-4 sm:px-5 flex items-center justify-center gap-2 font-black uppercase tracking-wider transition-transform hover:-translate-y-0.5 rounded-xl text-xs"
            style={{ color: "var(--team-on-primary)" }}
          >
            <Icons.Settings className="w-4 h-4 hidden sm:block" /> Build Lineup
          </button>
          {hasLineup && (
            <button
              type="button"
              onClick={() => run(regenerateLineup)}
              title="Re-roll a different valid lineup"
              className={secondaryBtn}
            >
              <Icons.Refresh className="w-4 h-4" /> Re-roll
            </button>
          )}
          {hasMore && (
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-controls={`lineup-more-${game.id}`}
              className={`${secondaryBtn} sm:hidden`}
            >
              More
              <Icons.ChevronUp
                className={`w-4 h-4 transition-transform ${moreOpen ? "" : "rotate-180"}`}
              />
            </button>
          )}
          {hasMore && (
            <div
              id={`lineup-more-${game.id}`}
              className={`${moreOpen ? "grid" : "hidden"} grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full sm:w-auto`}
            >
              {hasLineup && (
                <button
                  type="button"
                  onClick={() => run(regenerateBatting)}
                  title="Re-roll just the batting order — defense stays the same"
                  className={secondaryBtn}
                >
                  <Icons.Bat className="w-4 h-4" /> Re-roll Batting
                </button>
              )}
              {hasLineup && (
                <button
                  type="button"
                  onClick={() => run(regenerateDefense)}
                  title="Re-roll just the defensive schedule — batting order stays the same"
                  className={secondaryBtn}
                >
                  <Icons.Glove className="w-4 h-4" /> Re-roll Defense
                </button>
              )}
              {hasLineup && (
                <button
                  type="button"
                  onClick={async () => {
                    const defaultName = game.opponent
                      ? `vs ${game.opponent} · ${game.date || "—"}`
                      : "Lineup Template";
                    const name = await promptText({
                      title: "Save Lineup Template",
                      message:
                        "Reusable batting order + defensive plan. Apply it to any future game.",
                      defaultValue: defaultName,
                      confirmLabel: "Save Template",
                    });
                    setMoreOpen(false);
                    if (name) saveLineupTemplate?.(name);
                  }}
                  title="Save the current lineup + batting order as a reusable template"
                  className={secondaryBtn}
                >
                  <Icons.Save className="w-4 h-4" /> Save as Template
                </button>
              )}
              {templates.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const val = e.target.value;
                    e.target.value = "";
                    if (!val) return;
                    if (val.startsWith("apply:")) {
                      run(() => applyLineupTemplate?.(val.slice(6)));
                    } else if (val.startsWith("delete:")) {
                      setMoreOpen(false);
                      const id = val.slice(7);
                      const tpl = templates.find((t: any) => t.id === id);
                      void (async () => {
                        const ok = await confirm({
                          title: "Delete Template?",
                          message: `"${tpl?.name || "This template"}" will be removed from your saved templates. Games using this template aren't affected.`,
                          confirmLabel: "Delete",
                          danger: true,
                        });
                        if (ok) deleteLineupTemplate?.(id);
                      })();
                    }
                  }}
                  title="Apply or delete a saved lineup template"
                  aria-label="Lineup templates"
                  className="shrink-0 min-w-0 min-h-[44px] py-2.5 px-3 sm:px-4 font-black uppercase tracking-wider rounded-xl shadow-sm text-xs bg-surface border border-line hover:bg-surface-2 text-ink cursor-pointer"
                >
                  <option value="">Templates…</option>
                  <optgroup label="Apply">
                    {templates.map((tpl: any) => (
                      <option key={`a-${tpl.id}`} value={`apply:${tpl.id}`}>
                        {tpl.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Delete">
                    {templates.map((tpl: any) => (
                      <option key={`d-${tpl.id}`} value={`delete:${tpl.id}`}>
                        ✕ {tpl.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
