import React, { memo, useMemo, useState } from "react";
import { Icons } from "../icons";
import { formatStat, calculateBaseballAge } from "../utils/helpers";
import { useTeam, useUI, useToast } from "../contexts";
import { getPlayerInitials } from "../components/shared";
import { QRCodeImg } from "../components/QRCodeImg";
import { ImportCsvButton } from "../components/ImportCsvButton";
import { PitchingPlanPanel } from "../components/PitchingPlanPanel";
import { ArmCarePanel } from "../components/ArmCarePanel";
import { RosterStatsPanel } from "../components/RosterStatsPanel";
import { StaggerList, StaggerItem } from "../components/motion";

const INFIELD_POSITIONS = new Set(["1B", "2B", "3B", "SS"]);
const OUTFIELD_POSITIONS = new Set(["LF", "CF", "RF", "LCF", "RCF"]);

const FILTER_CHIPS = [
  { id: "present", label: "Present" },
  { id: "departed", label: "Departed" },
  { id: "pitchers", label: "Pitchers" },
  { id: "catchers", label: "Catchers" },
  { id: "infield", label: "Infield" },
  { id: "outfield", label: "Outfield" },
  { id: "leftyBats", label: "Lefty Bats" },
];

// Returns true if the player matches the given filter id. Unknown ids match.
// Position filters consult the position model — `comfortablePositions`,
// where catcher is just "C" in the list — with legacy `primaryPosition`
// kept as a last-resort fallback so teams that haven't been migrated
// still see something useful in the filter.
const playerComfortable = (player: any, pos: any) => {
  const list = Array.isArray(player.comfortablePositions)
    ? player.comfortablePositions
    : null;
  if (list && list.length > 0) return list.includes(pos);
  // Legacy fallback: not in restrictions → "comfortable"
  const restr = Array.isArray(player.restrictions) ? player.restrictions : [];
  if (restr.length > 0) return !restr.includes(pos);
  return player.primaryPosition === pos;
};

// A player is either active or Departed (the "inactive" status was retired in
// schema v10). Departed players are kept on the Roster for records but pulled
// from every other tab.
const getRosterStatus = (player: any) =>
  player.rosterStatus === "departed" ? "departed" : "active";

const playerMatchesFilter = (player: any, filterId: any) => {
  const rosterStatus = getRosterStatus(player);
  switch (filterId) {
    case "present":
      return rosterStatus === "active";
    case "departed":
      return rosterStatus === "departed";
    case "pitchers":
      return playerComfortable(player, "P");
    case "catchers":
      // Catcher is opt-in: strictly "C" present in the comfortable list
      // (no legacy "empty = anywhere" fallback for catcher).
      return (
        Array.isArray(player.comfortablePositions) &&
        player.comfortablePositions.includes("C")
      );
    case "infield":
      return [...INFIELD_POSITIONS].some((p) => playerComfortable(player, p));
    case "outfield":
      return [...OUTFIELD_POSITIONS].some((p) => playerComfortable(player, p));
    case "leftyBats":
      return player.bats === "L" || player.bats === "S";
    default:
      return true;
  }
};

const PlayerRow = memo(
  ({
    player,
    currentSeason,
    onOpenProfile,
    onSelectStats,
    selectedForStats,
    showPositionTag,
    logoUrl,
    stripped,
  }: any) => {
    const rosterStatus = getRosterStatus(player);
    const absent = rosterStatus !== "active";
    const hasDeparted = rosterStatus === "departed";
    const hasStats = player.stats?.ab > 0 || player.stats?.ip > 0;

    return (
      <div
        className={`grid grid-cols-[100px_1fr] sm:grid-cols-[100px_1fr_auto] items-stretch border-b border-line transition-all ${
          absent ? "opacity-85" : ""
        } ${selectedForStats ? "ring-2 ring-[var(--team-primary)] ring-inset" : ""}`}
      >
        <button
          type="button"
          onClick={() => onSelectStats?.(player.id)}
          title="View stats"
          aria-label={`View ${player.name} stats`}
          className="relative grid place-items-center overflow-hidden cursor-pointer"
          style={{
            background: absent
              ? "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), transparent 60%), linear-gradient(135deg, #64748b 0%, #475569 60%, #1e293b 100%)"
              : `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.25), transparent 60%), linear-gradient(135deg, var(--team-primary) 0%, color-mix(in srgb, var(--team-primary) 70%, #0f172a) 60%, #0f172a 100%)`,
          }}
        >
          {/* Position tag pinned top-left, jersey number anchored bottom-right,
            and the transparent logo sits directly on the cell's dark themed
            background (no white fill) in the middle. */}
          {showPositionTag && player.primaryPosition && (
            <span
              className="absolute top-1.5 left-2 t-chip px-1.5 py-0.5 rounded font-black uppercase text-white/85 z-10"
              style={{
                backgroundColor: "rgba(0,0,0,0.35)",
                fontSize: "9px",
                letterSpacing: "0.12em",
              }}
            >
              {player.primaryPosition}
            </span>
          )}
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={player?.name ? `${player.name} — team logo` : "Team logo"}
              className="w-16 h-16 object-contain"
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}
              loading="lazy"
            />
          ) : (
            <span className="grid place-items-center w-16 h-16 rounded-full bg-white/10 font-black text-xl text-white">
              {getPlayerInitials(player.name)}
            </span>
          )}
          {player.number != null && player.number !== "" && (
            <span
              className="absolute bottom-1.5 right-2 font-black text-2xl text-white tabular-nums z-10"
              style={{
                letterSpacing: "-0.03em",
                textShadow: "0 2px 4px rgba(0,0,0,0.55)",
              }}
            >
              {player.number}
            </span>
          )}
        </button>

        <div className="px-3.5 py-3 min-w-0 flex flex-col justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => onOpenProfile(player.id)}
                className="font-black text-base sm:text-lg uppercase tracking-tight text-ink leading-none hover:text-team-primary transition-colors text-left truncate"
              >
                {player.name}
              </button>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  absent ? "bg-ink-3" : "bg-win"
                }`}
                style={{
                  boxShadow: absent
                    ? "0 0 0 3px rgba(148,163,184,0.18)"
                    : "0 0 0 3px rgba(16,185,129,0.18)",
                }}
                title={hasDeparted ? "Departed" : "Present"}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              <span className="t-chip px-2 py-1 rounded-md bg-surface-2 border border-line text-ink">
                B/T · {player.bats || "R"}/{player.throws || "R"}
              </span>
              {player.primaryPosition && (
                <span
                  className="t-chip px-2 py-1 rounded-md bg-surface-2 border border-line text-ink"
                  title="Primary position"
                >
                  Primary Position · {player.primaryPosition}
                </span>
              )}
              {player.dob && (
                <span className="t-chip px-2 py-1 rounded-md bg-surface-2 border border-line text-ink">
                  Age {calculateBaseballAge(player.dob, currentSeason) || "?"}
                </span>
              )}
              {hasDeparted && (
                <span className="t-chip px-2 py-1 rounded-md border border-line bg-warn-bg text-warnfg">
                  Departed
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className={`hidden sm:grid col-span-2 sm:col-span-1 border-t sm:border-t-0 sm:border-l border-line ${
            stripped ? "grid-cols-1 sm:w-[150px]" : "grid-cols-4 sm:w-[260px]"
          }`}
        >
          {!hasStats ? (
            <div className="col-span-full grid place-items-center py-4 text-[10px] font-black text-ink-3 uppercase tracking-widest italic">
              No Stats Logged
            </div>
          ) : stripped ? (
            <div className="grid place-items-center px-3 py-2.5 text-center">
              <div className="font-black text-sm tabular-nums text-ink">
                <span style={{ color: "var(--team-primary)" }}>
                  {formatStat(player.stats?.avg)}
                </span>
                <span className="text-ink-3 mx-1">·</span>
                {formatStat(player.stats?.ops)}
              </div>
              <div className="t-eyebrow mt-0.5" style={{ fontSize: "8px" }}>
                AVG · OPS
              </div>
            </div>
          ) : (
            <>
              <div
                className="text-center px-2 py-2.5 border-r border-line relative"
                style={{ backgroundColor: "var(--team-primary-15)" }}
              >
                <div
                  className="t-eyebrow mb-1"
                  style={{ fontSize: "8px", color: "var(--team-primary)" }}
                >
                  AVG
                </div>
                <div
                  className="font-black text-base tabular-nums"
                  style={{ color: "var(--team-primary)" }}
                >
                  {formatStat(player.stats?.avg)}
                </div>
                <span
                  className="absolute left-0 right-0 bottom-0 h-[3px]"
                  style={{
                    background:
                      "linear-gradient(90deg, var(--team-primary), color-mix(in srgb, var(--team-primary) 70%, #0f172a))",
                  }}
                />
              </div>
              <div className="text-center px-2 py-2.5 border-r border-line">
                <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                  OPS
                </div>
                <div className="font-black text-base text-ink tabular-nums">
                  {formatStat(player.stats?.ops)}
                </div>
              </div>
              <div className="text-center px-2 py-2.5 border-r border-line">
                <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                  H
                </div>
                <div className="font-black text-base text-ink tabular-nums">
                  {player.stats?.h || 0}
                </div>
              </div>
              <div className="text-center px-2 py-2.5">
                <div className="t-eyebrow mb-1" style={{ fontSize: "8px" }}>
                  RBI
                </div>
                <div className="font-black text-base text-ink tabular-nums">
                  {player.stats?.rbi || 0}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    );
  },
);

// Collapsible share card for the public Player Info form. Lives on the Roster
// page (head-only) because it's about outfitting kids already on the roster.
// Reuses the team's standing share id on the /player-info-portal/ path — the
// same id the Tryouts/Interest link uses, so there's nothing extra to generate.
const PlayerInfoLinkCard = memo(({ team }: any) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const shareId = team?.tryoutShareId;
  const url =
    shareId && typeof window !== "undefined"
      ? `${window.location.origin}/player-info-portal/${shareId}`
      : null;

  return (
    <div className="bg-surface border border-line rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors"
        aria-expanded={open}
      >
        <div
          className="p-2 rounded-full shrink-0"
          style={{ backgroundColor: "var(--team-primary-15)" }}
        >
          <Icons.Users
            className="w-4 h-4"
            style={{ color: "var(--team-primary)" }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="t-button text-ink">Player Info Form</div>
          <p className="text-[11px] text-ink-3 font-medium">
            Collect uniform sizing, school & emergency contact from parents.
          </p>
        </div>
        <Icons.ChevronDown
          className={`w-4 h-4 text-ink-3 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line space-y-3">
          {url ? (
            <>
              <code className="block text-[11px] text-ink break-all font-mono bg-app border border-line rounded-md p-2">
                {url}
              </code>
              <div className="flex items-start gap-3 flex-wrap">
                <QRCodeImg
                  value={url}
                  size={120}
                  downloadable
                  filename={`${team?.name || "team"}-player-info-qr`}
                />
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(url);
                        toast.push({ kind: "success", title: "Link copied" });
                      }
                    }}
                    className="self-start px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-ink bg-surface border border-line rounded-md hover:bg-surface-2"
                  >
                    Copy
                  </button>
                  <p className="text-[10px] font-medium text-ink-3 leading-snug">
                    Submissions land in the Player Info tab, where you match
                    each one to a roster player.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-ink-3 font-medium leading-snug">
              Generate your team's share link first in{" "}
              <strong className="text-ink">Settings → Tryouts</strong>. The
              Player Info form reuses that same link.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

export const RosterTab = memo(() => {
  const {
    team,
    currentRole,
    uploadStatsCsv,
    exportRosterCsv,
    exportPlayerInfoCsv,
  } = useTeam();
  const canEdit = currentRole !== "assistant";
  const { setIsAddingPlayer, openPlayerProfile } = useUI();
  const { players, logoUrl, currentSeason } = team;
  const stripped = (team as any).statDisplay === "stripped";

  // Gameday filter state — per-session, intentionally not persisted.
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState(() => new Set());
  // Player whose stats fill the side panel (tap a jersey). null → team leaders.
  const [selectedStatsId, setSelectedStatsId] = useState<string | null>(null);

  const toggleFilter = (id: any) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearAll = () => {
    setActiveFilters(new Set());
    setSearchQuery("");
  };

  const sortedRosterPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      const numA = parseInt(a.number, 10);
      const numB = parseInt(b.number, 10);
      if (isNaN(numA) && isNaN(numB)) return a.name.localeCompare(b.name);
      if (isNaN(numA)) return 1;
      if (isNaN(numB)) return -1;
      return numA - numB;
    });
  }, [players]);

  // AND-combine: a player must match the search and every active filter chip.
  const visiblePlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedRosterPlayers.filter((p) => {
      if (q && !(p.name || "").toLowerCase().includes(q)) return false;
      for (const filterId of activeFilters) {
        if (!playerMatchesFilter(p, filterId)) return false;
      }
      return true;
    });
  }, [sortedRosterPlayers, searchQuery, activeFilters]);

  const activeRosterCount = useMemo(
    () => players.filter((p: any) => getRosterStatus(p) === "active").length,
    [players],
  );

  // Departed players sort to the bottom under their own header; active players
  // render first in the normal list.
  const visibleActive = useMemo(
    () => visiblePlayers.filter((p) => getRosterStatus(p) !== "departed"),
    [visiblePlayers],
  );
  const visibleDeparted = useMemo(
    () => visiblePlayers.filter((p) => getRosterStatus(p) === "departed"),
    [visiblePlayers],
  );

  const filtersActive = activeFilters.size > 0 || searchQuery.trim().length > 0;

  return (
    <div className="w-full space-y-6">
      {canEdit && <PlayerInfoLinkCard team={team} />}
      {canEdit && (
        <div className="cc-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-widest text-ink-3">
                Player Info completion
              </div>
              <div className="text-2xl font-black text-ink">
                {players.filter((p: any) => p.playerInfoSubmittedAt).length}/
                {players.length} submitted
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportRosterCsv}
                className="t-button"
              >
                Roster CSV
              </button>
              <button
                type="button"
                onClick={exportPlayerInfoCsv}
                className="t-button"
              >
                Player Info CSV
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {players.map((p: any) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 border border-line bg-surface px-3 py-2 text-xs font-bold"
              >
                <span className="truncate" title={p.name}>
                  Player #{p.number || "—"}
                </span>
                <span
                  className={p.playerInfoSubmittedAt ? "text-win" : "text-loss"}
                >
                  {p.playerInfoSubmittedAt
                    ? `✓ ${new Date(p.playerInfoSubmittedAt).toLocaleDateString()}`
                    : "✕ Missing"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <PitchingPlanPanel />
      <ArmCarePanel />
      <div className="space-y-6 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:items-start">
        <div className="border-b border-line pb-6">
          <div
            className="h-1.5 w-full"
            style={{ backgroundColor: "var(--team-primary)" }}
          />
          <div className="p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-line">
            <div className="flex items-center gap-4">
              <div
                className="p-2.5 rounded-full"
                style={{ backgroundColor: "var(--team-primary-15)" }}
              >
                <Icons.Jersey
                  className="w-6 h-6"
                  style={{ color: "var(--team-primary)" }}
                />
              </div>
              <h2 className="t-h2 flex items-center gap-3">
                Team Roster
                <span
                  className="t-chip px-2.5 py-1 rounded-lg"
                  style={{
                    backgroundColor: "var(--team-secondary)",
                    color: "var(--team-primary)",
                  }}
                >
                  {activeRosterCount} Active
                </span>
              </h2>
            </div>

            {canEdit && (
              <button
                type="button"
                onClick={() => setIsAddingPlayer(true)}
                className="btn-premium flex-1 sm:flex-none py-2.5 px-5 flex items-center justify-center gap-2 t-button rounded-xl hover:-translate-y-0.5 transition-transform"
                style={{ color: "var(--team-tertiary)" }}
              >
                <Icons.UserPlus className="w-4 h-4" /> Add Player
              </button>
            )}
          </div>
          {players.length > 0 && (
            <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-line space-y-3">
              <div className="relative">
                <Icons.User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search players by name…"
                  aria-label="Search roster"
                  className="w-full pl-9 pr-9 py-2.5 bg-surface border border-line rounded-xl outline-none focus:ring-2 focus:border-transparent text-sm font-bold text-ink shadow-sm transition-shadow"
                  style={
                    {
                      "--tw-ring-color": "var(--team-primary)",
                    } as React.CSSProperties
                  }
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-3 hover:text-ink rounded-md"
                  >
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {FILTER_CHIPS.map((chip) => {
                  const isActive = activeFilters.has(chip.id);
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => toggleFilter(chip.id)}
                      aria-pressed={isActive}
                      className="t-button px-3 py-1.5 min-h-[44px] inline-flex items-center rounded-full border transition-all"
                      style={
                        isActive
                          ? {
                              backgroundColor: "var(--team-secondary)",
                              color: "var(--team-primary)",
                              borderColor: "var(--team-primary)",
                            }
                          : {
                              backgroundColor: "var(--surface)",
                              color: "var(--ink-2)",
                              borderColor: "var(--line)",
                            }
                      }
                    >
                      {chip.label}
                    </button>
                  );
                })}
                {filtersActive && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="t-button px-3 py-1.5 min-h-[44px] inline-flex items-center rounded-full text-ink-3 hover:text-ink hover:bg-surface"
                  >
                    Clear All
                  </button>
                )}
                <span className="ml-auto t-eyebrow text-ink-3 tabular-nums">
                  {visiblePlayers.length} / {players.length}
                </span>
              </div>
            </div>
          )}
          <div className="p-4 sm:p-6">
            {players.length === 0 ? (
              <div className="text-center py-20">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Team Logo"
                    className="w-24 h-24 mx-auto mb-6 opacity-40 grayscale"
                  />
                ) : (
                  <div
                    className="text-5xl leading-none mb-4 opacity-80"
                    aria-hidden
                  >
                    🧢
                  </div>
                )}
                <h3 className="t-h3 mb-2 text-ink-3">No Roster Found</h3>
                <p className="t-body max-w-sm mx-auto">
                  Manually add players to build your team, or head to Settings
                  to import your stats file.
                </p>
              </div>
            ) : visiblePlayers.length === 0 ? (
              <div className="text-center py-12">
                <Icons.Jersey className="w-10 h-10 text-ink-3 mx-auto mb-3" />
                <p className="t-body max-w-sm mx-auto">
                  No players match the current filter — clear to see the full
                  roster.
                </p>
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-3 t-button px-3 py-2 rounded-lg border bg-surface border-line text-ink hover:bg-surface-2"
                >
                  Clear Filters
                </button>
              </div>
            ) : (
              <>
                {visibleActive.length > 0 && (
                  <StaggerList className="flex flex-col">
                    {visibleActive.map((player) => (
                      <StaggerItem key={player.id}>
                        <PlayerRow
                          player={player}
                          currentSeason={currentSeason}
                          onOpenProfile={openPlayerProfile}
                          onSelectStats={setSelectedStatsId}
                          selectedForStats={player.id === selectedStatsId}
                          showPositionTag={canEdit}
                          logoUrl={(team as any)?.logoUrl}
                          stripped={stripped}
                        />
                      </StaggerItem>
                    ))}
                  </StaggerList>
                )}
                {visibleDeparted.length > 0 && (
                  <div className={visibleActive.length > 0 ? "mt-6" : ""}>
                    <div className="flex items-center gap-2 px-1 pb-2 mb-1 border-b border-line">
                      <Icons.Users className="w-4 h-4 text-ink-3" />
                      <h3 className="text-xs font-black uppercase tracking-widest text-ink-3">
                        Departed
                      </h3>
                      <span className="t-eyebrow text-ink-3 tabular-nums">
                        {visibleDeparted.length}
                      </span>
                    </div>
                    <StaggerList className="flex flex-col opacity-90">
                      {visibleDeparted.map((player) => (
                        <StaggerItem key={player.id}>
                          <PlayerRow
                            player={player}
                            currentSeason={currentSeason}
                            onOpenProfile={openPlayerProfile}
                            onSelectStats={setSelectedStatsId}
                            selectedForStats={player.id === selectedStatsId}
                            showPositionTag={canEdit}
                            logoUrl={(team as any)?.logoUrl}
                            stripped={stripped}
                          />
                        </StaggerItem>
                      ))}
                    </StaggerList>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <RosterStatsPanel
          players={players}
          selectedId={selectedStatsId}
          onSelect={setSelectedStatsId}
        />
      </div>

      {canEdit && (
        <ImportCsvButton
          id="roster-import-csv"
          label="Import Roster"
          onChange={uploadStatsCsv}
          hint="TeamSnap roster or GameChanger CSV"
        />
      )}
      {canEdit && (
        <div className="cc-card p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-widest text-ink-3">
                Player Info completion
              </div>
              <div className="text-2xl font-black text-ink">
                {players.filter((p: any) => p.playerInfoSubmittedAt).length}/
                {players.length} submitted
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportRosterCsv}
                className="t-button"
              >
                Roster CSV
              </button>
              <button
                type="button"
                onClick={exportPlayerInfoCsv}
                className="t-button"
              >
                Player Info CSV
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {players.map((p: any) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 border border-line bg-surface px-3 py-2 text-xs font-bold"
              >
                <span className="truncate">{p.name || "Unnamed Player"}</span>
                <span
                  className={p.playerInfoSubmittedAt ? "text-win" : "text-loss"}
                >
                  {p.playerInfoSubmittedAt
                    ? `✓ ${new Date(p.playerInfoSubmittedAt).toLocaleDateString()}`
                    : "✕ Missing"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
