import React, { useState } from "react";
import { Icons } from "../../icons";
import { formatGameDateDisplay } from "../../utils/helpers";
import { isoInstantToLocalTime } from "../../utils/icsParse";
import { leagueRuleSetLabel } from "../../constants/ui";

// What the folded "Game details" row says about the game, so a coach can
// check the setup without opening it. `flags` are the settings that change
// how the lineup is built (Big Game, a scrimmage, fairness off) and are
// called out on their own so they can't hide in the fold.
export const gameDetailsSummary = ({
  date,
  startUtc,
  isHome,
  location,
  leagueRuleSet,
  gameType,
  pitchingFormat,
  defenseSize,
  positionLock,
  battingSize,
  isScrimmage,
  isBigGame,
  applySeasonalFairness,
  isTournamentGame,
}: {
  date?: string | null;
  startUtc?: string | null;
  isHome?: boolean;
  location?: string | null;
  leagueRuleSet?: string | null;
  gameType?: string | null;
  pitchingFormat?: string | null;
  defenseSize?: string | number | null;
  positionLock?: string | number | boolean | null;
  battingSize?: string | number | null;
  isScrimmage?: boolean;
  isBigGame?: boolean;
  applySeasonalFairness?: boolean;
  isTournamentGame?: boolean;
}): { when: string[]; setup: string[]; flags: string[] } => {
  const when = [
    formatGameDateDisplay(date),
    isoInstantToLocalTime(startUtc),
    isHome === false ? "Away" : "Home",
    (location || "").trim(),
  ].filter(Boolean);

  const rules = leagueRuleSetLabel(leagueRuleSet);
  // Rec / League is what a Rec game is unless the coach says otherwise, so
  // only a different classification is worth the space.
  const typeLabel =
    gameType === "pool"
      ? "Pool Play"
      : gameType === "bracket"
        ? "Bracket"
        : leagueRuleSet === "NKB"
          ? ""
          : "League";
  const lock = String(positionLock ?? "");
  const rotation =
    lock === "full"
      ? "Full-game positions"
      : lock === "1"
        ? "Rotate every inning"
        : /^\d+$/.test(lock)
          ? `Rotate every ${lock} inn`
          : "";
  const bat = String(battingSize ?? "");
  const setup = [
    rules,
    typeLabel,
    pitchingFormat || "",
    defenseSize ? `${defenseSize} fielders` : "",
    rotation,
    bat === "roster" ? "Bat the roster" : bat ? `Bat ${bat}` : "",
  ].filter(Boolean);

  const flags: string[] = [];
  if (isScrimmage) flags.push("Scrimmage");
  if (!isTournamentGame) {
    if (isBigGame) flags.push("Big Game");
    else if (applySeasonalFairness === false)
      flags.push("Even out playing time: off");
  }
  return { when, setup, flags };
};

// Wide screens have room for the settings, so they start open there; on a
// phone they start folded so attendance and the lineup come first.
const startsOpen = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(min-width: 1024px)").matches;

export const GameDetailsDisclosure = ({
  summary,
  children,
}: {
  summary: { when: string[]; setup: string[]; flags: string[] };
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(startsOpen);
  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="game-details-panel"
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-surface-2 transition-colors"
      >
        <Icons.Settings className="w-4 h-4 text-ink-3 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-black uppercase tracking-widest text-ink">
            Game details
          </div>
          {summary.when.length > 0 && (
            <div className="text-[11px] text-ink-2 font-bold mt-0.5">
              {summary.when.join(" · ")}
            </div>
          )}
          {summary.setup.length > 0 && (
            <div className="text-[11px] text-ink-3 font-medium">
              {summary.setup.join(" · ")}
            </div>
          )}
          {summary.flags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {summary.flags.map((f) => (
                <span
                  key={f}
                  className="t-chip px-2 py-0.5 rounded-full bg-warn-bg text-warnfg border border-line"
                >
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        <Icons.ChevronDown
          className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div id="game-details-panel">{children}</div>}
    </div>
  );
};
