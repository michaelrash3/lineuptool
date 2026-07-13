// src/hooks/useTeamLifecycle.ts
// Team lifecycle commands (switch / create / advance-season / upload-logo /
// delete / leave) extracted from TeamProvider. Pure DI: component state and
// setters are injected; Firestore + season-rollover utilities are imported
// directly. Logic is verbatim; the provider destructures the same six commands.
import { useCallback } from "react";
import type { User } from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  updateDoc,
  arrayRemove,
} from "firebase/firestore";
import { db, appId } from "../firebase";
import type {
  ConfirmContextValue,
  Player,
  ToastContextValue,
  TryoutSignup,
} from "../types";
import { errMessage } from "../utils/diagnostics";
import { downscaleImageToDataURL } from "../components/shared";
import { buildPlayerSeasonSummaries } from "../utils/playerDevelopment";
import { rolloverDevPlan } from "../utils/developmentPlan";
import {
  buildOpponentSeasonAggregates,
  appendOpponentArchive,
} from "../utils/opponentHistory";
import { saveEvalRound, deleteEvalRound } from "../utils/evalRounds";
import {
  blankStats,
  buildPreseasonSeedRound,
  dateToIsoLocal,
  isReturning,
  countsTowardStats,
  mergeTeamEntries,
  financeSummary,
  formatCurrency,
  rollFinancesForNewSeason,
  shouldRollFinances,
  genId,
} from "../utils/helpers";
import {
  DEFAULT_TEAM_DATA,
  NEW_TEAM_DOC,
  allowedPitchingFormats,
  bumpAgeTier,
  computeNextSeason,
} from "../constants/ui";

interface UseTeamLifecycleArgs {
  user: User | null;
  teams: { id: string; name: string }[];
  activeTeamId: string | null;
  setActiveTeamId: (id: string | null) => void;
  setSyncStatus: (status: string) => void;
  // teamData carries more fields at runtime than the strict Team interface
  // models; typed permissively (any) to mirror the TeamProvider surface.
  teamData: any;
  updateTeam: (
    patch: Record<string, unknown>,
    opts?: { allowEmptyPlayers?: boolean },
  ) => void;
  toast: ToastContextValue;
  confirm: ConfirmContextValue["confirm"];
}

export const useTeamLifecycle = ({
  user,
  teams,
  activeTeamId,
  setActiveTeamId,
  setSyncStatus,
  teamData,
  updateTeam,
  toast,
  confirm,
}: UseTeamLifecycleArgs) => {
  const switchTeam = useCallback(
    async (id: string) => {
      setActiveTeamId(id);
      if (!user) return;
      try {
        const ref = doc(
          db,
          "artifacts",
          appId,
          "users",
          user.uid,
          "settings",
          "teams",
        );
        await setDoc(ref, { activeTeamId: id }, { merge: true });
      } catch {
        /* non-fatal */
      }
    },
    [user, setActiveTeamId],
  );

  const createTeam = useCallback(
    async (name: string = "", leagueRuleSet?: "NKB" | "USSSA") => {
      if (!user || !name.trim()) return false;
      const id = genId("team");
      setSyncStatus("Creating");
      try {
        const teamRef = doc(
          db,
          "artifacts",
          appId,
          "public",
          "data",
          "teams",
          id,
        );
        await setDoc(teamRef, {
          ...NEW_TEAM_DOC,
          // The coach picks Rec (NKB) or Tournament (USSSA) at creation; this
          // drives the play-style (fairness vs competitive) and the rules
          // auto-config (defense size / pitching format).
          leagueRuleSet: leagueRuleSet || DEFAULT_TEAM_DATA.leagueRuleSet,
          name: name.trim(),
          ownerId: user.uid,
          members: [user.uid],
        });
        const userRef = doc(
          db,
          "artifacts",
          appId,
          "users",
          user.uid,
          "settings",
          "teams",
        );
        // Merge with the server's CURRENT team list, never just local state:
        // if this create was reached through a wrongly-shown welcome page
        // (teams state transiently empty), `[...teams, new]` would overwrite
        // the settings doc and orphan every existing team.
        let serverTeams: { id: string; name: string }[] | null = null;
        try {
          const settingsSnap = await getDoc(userRef);
          serverTeams = settingsSnap.exists()
            ? (((settingsSnap.data() as Record<string, unknown>)?.teams as
                | { id: string; name: string }[]
                | undefined) ?? null)
            : null;
        } catch {
          // Read failed — fall back to merging with local state only.
        }
        await setDoc(
          userRef,
          {
            teams: mergeTeamEntries(serverTeams, teams, [
              { id, name: name.trim() },
            ]),
            activeTeamId: id,
          },
          { merge: true },
        );
        toast.push({ kind: "success", title: "Team created" });
        setSyncStatus("");
        return true;
      } catch (e) {
        setSyncStatus("");
        toast.push({
          kind: "error",
          title: "Could not create team",
          message: errMessage(e),
        });
        return false;
      }
    },
    [user, teams, toast, setSyncStatus],
  );

  const advanceSeason = useCallback(
    async (
      opts: {
        skipConfirm?: boolean;
        tryoutsToPromote?: string[];
        tryoutDepositPayments?: Record<string, string>;
      } = {},
    ) => {
      const { skipConfirm = false, tryoutsToPromote = [] } = opts;
      const computed = computeNextSeason(teamData.currentSeason);
      if (!computed) {
        toast.push({
          kind: "warn",
          title: "Cannot determine next season",
          message: "Current season label needs to be like 'Spring 2026'.",
        });
        return;
      }
      const { nextSeason, shouldBump } = computed;
      const newAgeGroup = shouldBump
        ? bumpAgeTier(teamData.teamAge)
        : teamData.teamAge;

      // Compute team-level record from final games for the season being archived
      let wins = 0,
        losses = 0,
        ties = 0,
        runsScored = 0,
        runsAllowed = 0;
      for (const g of teamData.games) {
        if (!countsTowardStats(g)) continue;
        const ts = Number(g.teamScore);
        const os = Number(g.opponentScore);
        if (Number.isNaN(ts) || Number.isNaN(os)) continue;
        runsScored += ts;
        runsAllowed += os;
        if (ts > os) wins++;
        else if (ts < os) losses++;
        else ties++;
      }
      const seasonRecord = { wins, losses, ties, runsScored, runsAllowed };
      const archivedSeason = teamData.currentSeason;
      const archivedAge = teamData.teamAge;
      const archivedFormat = teamData.pitchingFormat;
      const playerCount = teamData.players.length;

      // Split current roster by the returning Y/N answer (with legacy
      // playerStatus fallback via isReturning). Returners keep their
      // slot; non-returners (explicit returning:false OR legacy
      // released/declined) are archived but dropped from the next
      // roster.
      const isDropped = (p: Player) => !isReturning(p);
      const droppedCount = teamData.players.filter(isDropped).length;
      // Tryout accepts ride on the same `team.players` array with
      // playerStatus === "accepted" — they join the new roster directly.
      const acceptedCount = teamData.players.filter(
        (p: Player) => p.playerStatus === "accepted",
      ).length;

      // The season YEAR runs Fall → Spring: the mid-year Fall→Spring advance
      // leaves the ledger and collections running untouched, and the money
      // rolls only when a new Fall begins. The full policy (and its tests)
      // lives in shouldRollFinances (utils/finances.ts).
      const hadFinanceActivity =
        ((teamData.finances?.payments || []).length ||
          (teamData.finances?.incomes || []).length ||
          (teamData.finances?.expenses || []).length) > 0;
      const rollFinances = shouldRollFinances(nextSeason, teamData.finances);
      const closingBalance =
        rollFinances && hadFinanceActivity
          ? financeSummary(teamData.finances, []).balanceNow
          : 0;

      // Confirmation
      const confirmMsg =
        `• ${playerCount} player${
          playerCount === 1 ? "" : "s"
        } will have stats archived to history\n` +
        (droppedCount > 0
          ? `• ${droppedCount} marked Released/Declined will be dropped\n`
          : "") +
        (acceptedCount > 0
          ? `• ${acceptedCount} tryout accept${
              acceptedCount === 1 ? "" : "s"
            } will join the new roster\n`
          : "") +
        `• Record being archived: ${wins}-${losses}${
          ties > 0 ? "-" + ties : ""
        }` +
        (wins + losses + ties === 0 ? " (no final games logged)" : "") +
        `\n` +
        `• Current stats and games will be cleared\n` +
        (rollFinances && hadFinanceActivity
          ? `• Club balance carried into the new season year: ${formatCurrency(
              closingBalance,
            )} (fee collections reset)\n`
          : rollFinances
            ? `• The planned team fee (${formatCurrency(
                teamData.finances?.nextClubFee,
              )}) takes effect for the new season\n`
            : hadFinanceActivity
              ? `• Finances keep running through the spring (fees cover the Fall–Spring year)\n`
              : "") +
        `• New season: ${nextSeason}` +
        (shouldBump
          ? ` (age advances ${archivedAge} → ${newAgeGroup})`
          : ` (age stays ${archivedAge})`) +
        `\n\n` +
        `This cannot be undone.`;

      // The Advance Season page already walked the head through every
      // marking and showed a full summary, so the confirm here is a
      // duplicate gate when the call came from the wizard. Direct
      // callers (anywhere besides that page) still see the confirm
      // dialog.
      if (!skipConfirm) {
        const ok = await confirm({
          title: `Archive ${archivedSeason}?`,
          message: `${archivedAge}, ${archivedFormat}\n\n${confirmMsg}`,
          confirmLabel: "Advance Season",
          danger: true,
        });
        if (!ok) return;
      }

      const nowIso = new Date().toISOString();

      // Compact per-player development summaries (positions played, eval
      // first/last, attendance rate, games with lines). Computed from the
      // same pre-advance snapshot as seasonRecord because the inputs — games,
      // practices, eval rounds — are all cleared below; this is the only
      // development data that survives into pastSeasons. Bounded at a few
      // hundred bytes per player per season (1MB team-doc cap).
      const devSummaries = buildPlayerSeasonSummaries({
        players: teamData.players,
        games: teamData.games || [],
        practices: teamData.practices || [],
        evaluationEvents: teamData.evaluationEvents || [],
        teamAge: teamData.teamAge,
      });

      // Per-opponent W-L/runs aggregates from the closing season's games —
      // the games array is wiped below, and this archive is what keeps the
      // head-to-head history ("5-3 all-time vs the Cubs") alive across
      // seasons. Bounded (oldest entries fall off) so it can't bloat the doc.
      const opponentArchive = appendOpponentArchive(
        teamData.opponentArchive,
        buildOpponentSeasonAggregates(teamData.games || [], archivedSeason),
      );

      // Archive each player's current stats into pastSeasons[]; drop the
      // ones marked Released/Declined; reset surviving statuses to
      // "returning" so the next cycle starts clean.
      const updatedPlayers = teamData.players
        .filter((p: Player) => !isDropped(p))
        .map((p: Player) => {
          // pastSeasons entries carry richer fields (ageGroup/record) than the
          // slim shared type, so widen locally before appending the archive row.
          const past: Array<Record<string, unknown>> = Array.isArray(
            p.pastSeasons,
          )
            ? [...(p.pastSeasons as Array<Record<string, unknown>>)]
            : [];
          // Only archive if there's something meaningful: a non-empty stat
          // line, or a development summary (a kid can have eval rounds and
          // attendance worth keeping even with no imported stats).
          const stats = p.stats || blankStats();
          const hasAnyData = Object.values(stats).some((v) => Number(v) > 0);
          const summary = devSummaries.get(p.id);
          if (hasAnyData || summary) {
            past.push({
              season: archivedSeason,
              ageGroup: archivedAge,
              pitchingFormat: archivedFormat,
              record: seasonRecord,
              stats: { ...stats },
              ...(summary ? { summary } : {}),
            });
          }
          // Injury statuses belong to the closed season — a stale "out"
          // would silently bench a healthy kid next spring. The dev plan
          // partially carries: focus areas, assigned drills, and still-active
          // goals continue; resolved goals (archived in the summary above)
          // and old-season check-ins are dropped (rolloverDevPlan).
          const { health: _staleHealth, devPlan: _oldPlan, ...rest } = p;
          const carriedPlan = rolloverDevPlan(p.devPlan);
          return {
            ...rest,
            ...(carriedPlan ? { devPlan: carriedPlan } : {}),
            pastSeasons: past,
            stats: blankStats(),
            pitching: { recentPitches: 0, lastPitchDate: null },
            // After advance, every surviving player is treated as
            // returning for the new season.
            playerStatus: "returning",
          };
        });

      // Tryout signups selected for promotion become full Player rows on
      // the new roster. Mirrors acceptTryout's mapping but bulk and at
      // advance-time. Every tryout signup is cleared from the team
      // afterward — they don't carry over to the new season regardless of
      // whether they were promoted (interest signups are untouched).
      const promotionSet = new Set(tryoutsToPromote);
      const promotedPairs = (teamData.tryoutSignups || [])
        .filter((s: TryoutSignup) => promotionSet.has(s.id))
        .map((s: TryoutSignup) => {
          const player = {
            id: genId("p"),
            name: `${s.firstName || ""} ${s.lastName || ""}`.trim() || "Player",
            number: s.tryoutNumber || s.number || "",
            dob: s.dob || "",
            bats: s.bats || "R",
            throws: s.throws || "R",
            comfortablePositions: [
              ...(Array.isArray(s.comfortablePositions)
                ? s.comfortablePositions
                : []
              ).filter((p: string) => p !== "C"),
              ...(s.isCatcher === true ? ["C"] : []),
            ],
            parentName: s.parentName || "",
            email: s.email || "",
            phone: s.phone || "",
            present: true,
            playerStatus: "returning",
            pastSeasons: [],
            stats: blankStats(),
            pitching: { recentPitches: 0, lastPitchDate: null },
            tryoutSignupId: s.id,
          };
          return { signup: s, player };
        });
      const promotedPlayers = promotedPairs.map(
        ({ player }: { signup: TryoutSignup; player: Player }) => player,
      );

      // Seed the new season's Preseason eval round: returning players carry
      // their most recent eval forward, promoted tryouts carry their tryout
      // evaluation. Null when there's nothing to seed → start with no rounds.
      const preseasonRound = buildPreseasonSeedRound(
        teamData.evaluationEvents || [],
        updatedPlayers,
        promotedPlayers,
        {
          date: dateToIsoLocal(new Date()),
          evaluatorId: user?.uid,
          tryoutSessions: teamData.tryoutSessions || [],
          // Showcase measurements ride the signups — the seed overlays them
          // as definitive values on top of the subjective tryout blend.
          tryoutSignups: teamData.tryoutSignups || [],
          teamAge: teamData.teamAge,
        },
      );

      const newSeasonFinances = rollFinances
        ? rollFinancesForNewSeason(
            teamData.finances,
            archivedSeason,
            nowIso,
            // The PRE-advance roster: the families who owed the closing year.
            teamData.players || [],
          )
        : teamData.finances;
      const depositAmount = Math.max(
        0,
        Number(newSeasonFinances?.depositAmount) || 0,
      );
      const tryoutDepositPayments = (opts?.tryoutDepositPayments ||
        {}) as Record<string, string>;
      const promotedDepositPayments =
        depositAmount > 0
          ? promotedPairs
              .filter(
                ({ signup }: { signup: TryoutSignup; player: Player }) =>
                  tryoutDepositPayments[signup.id] != null,
              )
              .map(
                ({
                  signup,
                  player,
                }: {
                  signup: TryoutSignup;
                  player: Player;
                }) => ({
                  id: genId(`pay-deposit-${signup.id}`),
                  playerId: player.id,
                  date: String(
                    tryoutDepositPayments[signup.id] || nowIso,
                  ).slice(0, 10),
                  amount: depositAmount,
                  // Attribution stamp (audit finding 3.7) — the advancing
                  // coach recorded these promoted deposits.
                  ...(user?.uid ? { recordedBy: user.uid } : {}),
                  recordedAt: nowIso,
                }),
              )
          : [];

      const financesWithTryoutDeposits =
        promotedDepositPayments.length > 0 || rollFinances
          ? {
              ...(newSeasonFinances || {}),
              payments: [
                ...(newSeasonFinances?.payments || []),
                ...promotedDepositPayments,
              ],
            }
          : undefined;

      // Season reset of eval rounds, per-doc in the evalRounds subcollection:
      // the closing season's rounds are deleted (the head may delete any
      // round) and the preseason seed is written as a fresh subcollection
      // doc — the legacy array key is omitted from updateTeam entirely so the
      // advance never recreates the dropped field (the rules reject that).
      if (activeTeamId) {
        for (const ev of teamData.evaluationEvents || []) {
          if (ev?.id) {
            void deleteEvalRound(db, appId, activeTeamId, ev.id).catch(
              () => {},
            );
          }
        }
        if (preseasonRound) {
          void saveEvalRound(db, appId, activeTeamId, preseasonRound).catch(
            () => {
              toast.push({
                kind: "error",
                title: "Preseason eval seed didn't save",
                message:
                  "The season advanced, but the seeded eval round failed to write. Start a new eval round manually.",
              });
            },
          );
        }
      }

      // allowEmptyPlayers: a roster where nobody returns (and no tryout
      // promotions) is legitimately empty after an explicitly-confirmed
      // advance — the persistTeam wipe guard must not block it.
      // The age bump can change what's legal to pitch (8U Machine/Coach →
      // 9U is always Kid Pitch); correct the format in the same write.
      const allowedNextFormats = allowedPitchingFormats(
        teamData.leagueRuleSet,
        newAgeGroup,
      );
      updateTeam(
        {
          currentSeason: nextSeason,
          teamAge: newAgeGroup,
          ...(allowedNextFormats.includes(teamData.pitchingFormat)
            ? {}
            : { pitchingFormat: allowedNextFormats[0] }),
          players: [...updatedPlayers, ...promotedPlayers],
          games: [],
          // Tournaments reference games by id; with games cleared they'd be
          // zombie entries (dangling gameIds + pitch plans), so they reset
          // with the schedule they described.
          tournaments: [],
          // Head-to-head history survives the games wipe as per-opponent
          // aggregates (built above from the closing season's results).
          opponentArchive,
          // Practices belong to the season just closed — start the new season
          // with a clean slate rather than carrying last year's dates forward.
          practices: [],
          // GameChanger issues a new calendar feed per season, so the prior
          // season's URL is dead here. Clear it alongside the games reset so
          // the Schedule auto-sync doesn't fire against the stale feed and the
          // import modal starts blank, prompting the coach for the new link.
          gcCalendarUrl: "",
          tryoutSessions: [],
          tryoutSignups: [],
          tryoutsOpen: false,
          lastSeasonAdvanceAt: nowIso,
          ...(financesWithTryoutDeposits
            ? {
                finances: financesWithTryoutDeposits,
              }
            : {}),
        },
        { allowEmptyPlayers: true },
      );
      toast.push({
        kind: "success",
        title: `Advanced to ${nextSeason}`,
        message:
          (shouldBump
            ? `Age group is now ${newAgeGroup}.`
            : `Age group stays ${newAgeGroup}.`) +
          (promotedPlayers.length > 0
            ? ` ${promotedPlayers.length} tryout${
                promotedPlayers.length === 1 ? "" : "s"
              } promoted to roster.`
            : ""),
      });
    },
    [teamData, updateTeam, toast, confirm, user, activeTeamId],
  );

  const uploadLogo = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Instead of rejecting an oversized logo, auto-shrink it: downscale to a
      // sensible logo size and re-encode (WebP when supported — keeps
      // transparency and compresses well) so it always fits inline under the
      // Firestore 1 MiB document cap. Images already small enough pass through
      // untouched, so we never degrade a good logo.
      downscaleImageToDataURL(file, { maxDim: 512, targetBytes: 200_000 })
        .then((dataUrl: string) => {
          const wasShrunk = dataUrl.length < (file.size || 0);
          // Final safety net: even a shrunk logo can't save if the rest of the
          // team doc is already near the cap. This should essentially never
          // fire now, but warn rather than let the write silently fail.
          const HARD_LIMIT = 900_000; // leave headroom for Firestore overhead
          const approxSize = JSON.stringify({
            ...teamData,
            logoUrl: dataUrl,
          }).length;
          if (approxSize > HARD_LIMIT) {
            toast.push({
              kind: "error",
              title: "Logo still too large to save",
              message:
                "Even after shrinking, your team data would exceed Firestore's 1 MB document limit. Try removing old data before adding a logo.",
              duration: 8000,
            });
            return;
          }
          updateTeam({ logoUrl: dataUrl });
          toast.push({
            kind: "success",
            title: wasShrunk ? "Logo resized & saved" : "Logo updated",
            message: wasShrunk
              ? "Your image was automatically compressed to fit."
              : undefined,
          });
        })
        .catch(() =>
          toast.push({
            kind: "error",
            title: "Could not process image",
            message: "That file didn't look like a valid image.",
          }),
        );
    },
    [teamData, updateTeam, toast],
  );

  const deleteTeamCmd = useCallback(async () => {
    if (!user || teams.length <= 1) return;
    const ok = await confirm({
      title: "Permanently delete this team?",
      message:
        "Roster, schedule, stats, and evaluations are all deleted. This cannot be undone.",
      confirmLabel: "Delete Team",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDoc(
        doc(db, "artifacts", appId, "public", "data", "teams", activeTeamId!),
      );
      const remaining = teams.filter((t) => t.id !== activeTeamId);
      const userRef = doc(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "settings",
        "teams",
      );
      await setDoc(
        userRef,
        { teams: remaining, activeTeamId: remaining[0]?.id || null },
        { merge: true },
      );
      toast.push({ kind: "success", title: "Team deleted" });
    } catch (e) {
      toast.push({
        kind: "error",
        title: "Delete failed",
        message: errMessage(e),
      });
    }
  }, [user, teams, activeTeamId, toast, confirm]);

  const leaveTeamCmd = useCallback(async () => {
    if (!user || teams.length <= 1) return;
    const ok = await confirm({
      title: "Leave this team?",
      message: "A coach can re-invite you with a join code later.",
      confirmLabel: "Leave Team",
      danger: true,
    });
    if (!ok) return;
    try {
      const teamRef = doc(
        db,
        "artifacts",
        appId,
        "public",
        "data",
        "teams",
        activeTeamId!,
      );
      // Atomic self-removal: arrayRemove drops only this user without a
      // read-modify-write of the whole members array, so a concurrent join
      // can't be clobbered. The selfRemoveOnly() rule permits exactly this.
      await updateDoc(teamRef, { members: arrayRemove(user.uid) });
      const remaining = teams.filter((t) => t.id !== activeTeamId);
      const userRef = doc(
        db,
        "artifacts",
        appId,
        "users",
        user.uid,
        "settings",
        "teams",
      );
      await setDoc(
        userRef,
        { teams: remaining, activeTeamId: remaining[0]?.id || null },
        { merge: true },
      );
      toast.push({ kind: "success", title: "Left team" });
    } catch (e) {
      toast.push({
        kind: "error",
        title: "Could not leave",
        message: errMessage(e),
      });
    }
  }, [user, teams, activeTeamId, toast, confirm]);

  return {
    switchTeam,
    createTeam,
    advanceSeason,
    uploadLogo,
    deleteTeamCmd,
    leaveTeamCmd,
  };
};
