import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { UIContext, useTeam, useToast } from "../contexts";
import { APP_NAME, getLocalDateString } from "../constants/ui";
import { applyLineupSwap } from "../utils/lineupSwap";
import { isPlayerUnavailable, evalRoundRecency } from "../utils/helpers";
import type {
  EvaluationEvent,
  Game,
  GradeMap,
  Inning,
  SlimPlayer,
  TournamentPlan,
} from "../types";

// UIProvider extracted from App.tsx: local UI state (modals, selections,
// in-game session, attendance) exposed through UIContext.

const TAB_TITLE_LABELS: Record<string, string> = {
  home: "Dashboard",
  stats: "Stats",
  roster: "Roster",
  schedule: "Schedule",
  practices: "Practices",
  evaluation: "Evaluation",
  tryouts: "Tryouts",
  interest: "Interest",
  playerInfo: "Player Info",
  availability: "Availability",
  finances: "Finances",
  settings: "Settings",
};

export const UIProvider = ({ children }: { children: React.ReactNode }) => {
  const team = useTeam();
  const toast = useToast();
  const navigateToRoute = useNavigate();

  const [modal, setModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    type: "alert",
    onConfirm: null,
  });

  // Schedule tab state
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [isAddingGame, setIsAddingGame] = useState(false);
  const [newGameForm, setNewGameForm] = useState({
    date: getLocalDateString(),
    opponent: "",
    leagueRuleSet: "USSSA",
    pitchingFormat: "Kid Pitch",
    isScrimmage: false,
  });
  const [scoringGameId, setScoringGameId] = useState<string | null>(null); // game whose score is being entered inline
  const [inGameId, setInGameId] = useState<string | null>(null); // game currently in In-Game mode
  const [inGameInning, setInGameInning] = useState(0); // current inning during in-game mode (0-indexed)
  const [inGameSelection, setInGameSelection] = useState<{
    type: "position" | "bench";
    pos?: string;
    playerId?: string;
  } | null>(null); // first tap of a swap pair
  const [inGameUndoStack, setInGameUndoStack] = useState<unknown[]>([]); // last swap undo data
  const [activeTab, setActiveTab] = useState("home");
  // The past-season import review lives at /roster/import/past-season; the
  // parsed rows travel via navigation state, not provider state.
  const [currentGameAttendance, setCurrentGameAttendance] = useState<
    Record<string, boolean>
  >({});
  const [firstInningLineup, setFirstInningLineup] = useState<
    Record<string, string>
  >({});
  const [lineup, setLineup] = useState<Inning[] | null>(null);
  const [battingLineup, setBattingLineup] = useState<SlimPlayer[] | null>(null);
  // Penalty score emitted by the engine for the current in-editor lineup
  // (null when no generated lineup is in scope). Lower = better.
  const [lineupQualityPenalty, setLineupQualityPenalty] = useState<
    number | null
  >(null);
  // Tournament plan (starters / scripted subs / relief options) riding with
  // the current in-editor lineup. Null for Rec lineups.
  const [tournamentPlan, setTournamentPlan] = useState<TournamentPlan | null>(
    null,
  );
  const [swapSelection, setSwapSelection] = useState<{
    innIdx: number;
    pos: string;
    player: SlimPlayer;
  } | null>(null);
  const [gameSaved, setGameSaved] = useState(false);
  const [opponentName, setOpponentName] = useState("");

  // Header state
  const [isAddingTeam, setIsAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  // Roster/profile state. Adding a player is a routed page (/roster/new) —
  // see openAddPlayer below.
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);

  // Help lives at /help and /help/:topicId (routed pages) — deep links go
  // through navigate, not provider state.

  // Coach state
  const [isAddingCoach, setIsAddingCoach] = useState(false);
  const [newCoachForm, setNewCoachForm] = useState({
    name: "",
    role: "Head Coach",
  });

  // Eval state
  const [teamEvalGrades, setTeamEvalGrades] = useState<
    Record<string, GradeMap>
  >({});
  // Eval round selection: null = creating a new round, otherwise = id of an
  // existing eval event being viewed/edited.
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  // Eval trend lives at /evaluation/trend/:playerId (routed page).

  // Sync attendance/firstInning/lineup with the selected game
  const gamesRef = useRef(team.team.games);
  useEffect(() => {
    gamesRef.current = team.team.games;
  }, [team.team.games]);

  // Dynamic browser-tab title: "<Team Name> · <Screen>" so the tab (and any
  // bookmark) reflects which team and screen the coach is on. Falls back to
  // the brand name before a team has loaded. The public Tryouts Portal sets
  // its own title (see TryoutsPortal) — this provider doesn't wrap it.
  const teamName = team.team?.name;
  useEffect(() => {
    const screen = inGameId ? "In-Game" : TAB_TITLE_LABELS[activeTab] || "";
    const name = (teamName || "").trim();
    document.title = name ? (screen ? `${name} · ${screen}` : name) : APP_NAME;
  }, [teamName, activeTab, inGameId]);

  // Snapshot of the game data we last loaded into local editor state, used
  // by the conflict-detection effect below. We compare against this — not
  // against the live `team.team.games` reference — so we can tell whether
  // the *user* edited locally vs. whether a *remote* snapshot changed the
  // game underneath us.
  const loadedGameRef = useRef<{
    id: string;
    lineupJson: string;
    battingJson: string;
  } | null>(null);

  useEffect(() => {
    if (!selectedGameId) {
      loadedGameRef.current = null;
      return;
    }
    const game = gamesRef.current.find((g: Game) => g.id === selectedGameId);
    if (!game) return;
    loadedGameRef.current = {
      id: game.id,
      lineupJson: JSON.stringify(game.lineup || null),
      battingJson: JSON.stringify(game.battingLineup || null),
    };
    setOpponentName(game.opponent || "");
    setLineup(game.lineup || null);
    setBattingLineup(game.battingLineup || null);
    setLineupQualityPenalty(
      typeof game.qualityPenalty === "number" ? game.qualityPenalty : null,
    );
    setTournamentPlan(game.tournamentPlan || null);
    setCurrentGameAttendance(game.attendance || {});
    setGameSaved(false);
  }, [selectedGameId]);

  // Detect when a remote Firestore snapshot updates the game we're editing.
  // If the user has no unsaved local changes, silently re-sync. If they do,
  // surface a toast so they know their next save will clobber the remote
  // edit (better than silently overwriting another coach's work).
  useEffect(() => {
    if (!selectedGameId || !loadedGameRef.current) return;
    if (loadedGameRef.current.id !== selectedGameId) return;
    const game = team.team.games.find((g: Game) => g.id === selectedGameId);
    if (!game) return;

    const remoteLineupJson = JSON.stringify(game.lineup || null);
    const remoteBattingJson = JSON.stringify(game.battingLineup || null);
    const remoteChanged =
      remoteLineupJson !== loadedGameRef.current.lineupJson ||
      remoteBattingJson !== loadedGameRef.current.battingJson;
    if (!remoteChanged) return;

    const localLineupJson = JSON.stringify(lineup || null);
    const localBattingJson = JSON.stringify(battingLineup || null);
    const localUnsaved =
      localLineupJson !== loadedGameRef.current.lineupJson ||
      localBattingJson !== loadedGameRef.current.battingJson;
    // The remote snapshot already matches what we have locally — this is our
    // OWN save echoing back (or another device landing on the identical
    // lineup), NOT a conflict. Adopt it silently. Without this guard the
    // warning fired on every save you made, since loadedGameRef still held
    // the pre-edit version.
    const remoteMatchesLocal =
      remoteLineupJson === localLineupJson &&
      remoteBattingJson === localBattingJson;

    if (!localUnsaved || remoteMatchesLocal) {
      loadedGameRef.current = {
        id: game.id,
        lineupJson: remoteLineupJson,
        battingJson: remoteBattingJson,
      };
      setLineup(game.lineup || null);
      setBattingLineup(game.battingLineup || null);
      setCurrentGameAttendance(game.attendance || {});
    } else {
      toast.push({
        kind: "warn",
        title: "Game updated remotely",
        message:
          "Another device changed this game while you were editing. Saving now will overwrite those changes.",
        duration: 8000,
      });
      // Update the snapshot so we don't fire the warning again for the
      // same remote version.
      loadedGameRef.current = {
        id: game.id,
        lineupJson: remoteLineupJson,
        battingJson: remoteBattingJson,
      };
    }
  }, [team.team.games, selectedGameId, lineup, battingLineup, toast]);

  // Clear any selected/scoring/in-game id whose underlying game has been
  // deleted (locally or via a remote snapshot). Without this, the UI would
  // try to render against a non-existent game until the next interaction.
  useEffect(() => {
    const ids = new Set(team.team.games.map((g: Game) => g.id));
    if (selectedGameId && !ids.has(selectedGameId)) setSelectedGameId(null);
    if (scoringGameId && !ids.has(scoringGameId)) setScoringGameId(null);
    if (inGameId && !ids.has(inGameId)) setInGameId(null);
  }, [team.team.games, selectedGameId, scoringGameId, inGameId]);
  // When players list changes, fill in attendance defaults. A kid defaults
  // absent when inactive on the roster, scheduled out on the game's date
  // (absences entered ahead of time on the player profile), OR injured-out
  // (health status on the profile) — the coach can still toggle them back in
  // the Game Day Attendance grid.
  useEffect(() => {
    const gameDate = team.team.games.find(
      (g: Game) => g.id === selectedGameId,
    )?.date;
    setCurrentGameAttendance((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of team.team.players) {
        if (next[p.id] === undefined) {
          next[p.id] = p.present !== false && !isPlayerUnavailable(p, gameDate);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [team.team.players, team.team.games, selectedGameId]);

  // Sync teamEvalGrades based on selectedRoundId:
  //   - If a specific round is selected, load its grades for editing
  //   - If no round selected (= creating new), load from latest round as a
  //     starting baseline. Coach can then adjust and save as a new round.
  useEffect(() => {
    if (!team.user) return;
    const mine = team.team.evaluationEvents
      .filter(
        (e: EvaluationEvent) =>
          e.coachRole === "Head" && e.evaluatorId === team.user.uid,
      )
      // createdAt-aware: rounds snapped to the same due date used to tie and
      // resolve to the OLDER one, pre-filling stale grades.
      .sort(evalRoundRecency);
    if (selectedRoundId) {
      const target = mine.find(
        (e: EvaluationEvent) => e.id === selectedRoundId,
      );
      if (target?.grades) setTeamEvalGrades(target.grades);
    } else {
      // Pre-fill with the latest round's grades when starting a new round
      if (mine[0]?.grades) setTeamEvalGrades(mine[0].grades);
    }
  }, [team.user, team.team.evaluationEvents, selectedRoundId]);

  // Lineup edits (swap / add inning / remove inning / reorder batters)
  const handleCellClick = useCallback(
    (innIdx: number, pos: string, player: SlimPlayer) => {
      if (!swapSelection) {
        if (player) setSwapSelection({ innIdx, pos, player });
        return;
      }
      if (swapSelection.innIdx !== innIdx) {
        setSwapSelection({ innIdx, pos, player });
        return;
      }
      if (swapSelection.pos === pos) {
        setSwapSelection(null);
        return;
      }
      setLineup((cur: Inning[] | null) => {
        if (!cur) return cur;
        // Lineup edits carry forward to the remaining innings so the coach's
        // change holds for the rest of the game — not just the inning they
        // edited — while leaving the rule-capped catcher and any inning whose
        // arrangement already differs (rotation / scripted subs) alone. See
        // applyLineupSwap for the full contract.
        return applyLineupSwap(cur, {
          innIdx,
          sPos: swapSelection.pos,
          // swapSelection is only seeded from a truthy player tap, so non-null.
          sPlayer: swapSelection.player as NonNullable<SlimPlayer>,
          tPos: pos,
          tPlayer: player,
          carryForward: true,
        });
      });
      setSwapSelection(null);
    },
    [swapSelection],
  );

  const addInning = useCallback(() => {
    if (!lineup) return;
    const last = lineup[lineup.length - 1] || {};
    // Deep-copy BENCH so the new inning doesn't share an array reference with
    // the previous one — a subsequent BENCH edit would otherwise mutate both.
    const cloned = {
      ...last,
      BENCH: Array.isArray(last.BENCH) ? [...last.BENCH] : [],
    };
    setLineup([...lineup, cloned]);
  }, [lineup]);

  const removeInning = useCallback(() => {
    if (!lineup || lineup.length <= 1) return;
    setLineup(lineup.slice(0, -1));
  }, [lineup]);

  const moveBatter = useCallback((idx: number, delta: number) => {
    setBattingLineup((cur: SlimPlayer[] | null) => {
      if (!cur) return cur;
      const target = idx + delta;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  // Each player has their own page now: navigate to /player/:id. The route's
  // PlayerProfilePage sets viewingPlayerId, which the profile content reads.
  const openPlayerProfile = useCallback(
    (id: string) => navigateToRoute(`/roster/${id}`),
    [navigateToRoute],
  );

  // Adding a player is the /roster/new page. A provider-level shortcut (like
  // openPlayerProfile) so Home, the palette, tours, and help CTAs can all
  // open it without each pulling in useNavigate.
  const openAddPlayer = useCallback(
    () => navigateToRoute("/roster/new"),
    [navigateToRoute],
  );

  // Wire the bridge that TeamProvider uses. The ref is a foreign object
  // owned by TeamProvider; mutating it during render would be a
  // setState-like side effect. Defer to an effect that runs after commit
  // so React's rules-of-hooks invariants hold and concurrent rendering
  // can't observe a half-written bridge.
  const uiBridgeRef = team.uiBridge;
  useEffect(() => {
    uiBridgeRef.current = {
      getInputs: () => {
        const currentGame = team.team.games.find(
          (g: Game) => g.id === selectedGameId,
        );
        return {
          currentGame,
          currentGameAttendance,
          firstInningLineup,
          previousLineup: lineup,
          previousBattingLineup: battingLineup,
          lineup,
          battingLineup,
          lineupQualityPenalty,
          tournamentPlan,
          teamEvalGrades,
          selectedRoundId,
        };
      },
      applyResult: ({
        lineup: newLineup,
        battingLineup: newBatting,
        qualityPenalty,
        tournament,
      }: {
        lineup: Inning[] | null;
        battingLineup: SlimPlayer[] | null;
        qualityPenalty?: number | null;
        tournament?: TournamentPlan | null;
      }) => {
        setLineup(newLineup);
        setBattingLineup(newBatting);
        setLineupQualityPenalty(
          typeof qualityPenalty === "number" ? qualityPenalty : null,
        );
        // A Rec result (no tournament field) clears any stale plan.
        setTournamentPlan(tournament || null);
        setSwapSelection(null);
        setGameSaved(false);
      },
      applyTemplate: (
        tpl: {
          lineup?: Inning[] | null;
          battingLineup?: SlimPlayer[] | null;
        } | null,
      ) => {
        if (!tpl) return;
        setLineup(tpl.lineup || null);
        setBattingLineup(tpl.battingLineup || null);
        // Templates predate these fields — clear them so the chip doesn't
        // show a stale quality score or sub plan from a different lineup.
        setLineupQualityPenalty(null);
        setTournamentPlan(null);
        setSwapSelection(null);
        setGameSaved(false);
      },
      markSaved: () => {
        setGameSaved(true);
        setTimeout(() => setGameSaved(false), 2000);
      },
    };
  });

  const value = useMemo(
    () => ({
      modal,
      setModal,
      selectedGameId,
      setSelectedGameId,
      isAddingGame,
      setIsAddingGame,
      newGameForm,
      setNewGameForm,
      scoringGameId,
      setScoringGameId,
      activeTab,
      setActiveTab,
      inGameId,
      setInGameId,
      inGameInning,
      setInGameInning,
      inGameSelection,
      setInGameSelection,
      inGameUndoStack,
      setInGameUndoStack,
      currentGameAttendance,
      setCurrentGameAttendance,
      firstInningLineup,
      setFirstInningLineup,
      lineup,
      setLineup,
      battingLineup,
      setBattingLineup,
      lineupQualityPenalty,
      tournamentPlan,
      swapSelection,
      gameSaved,
      handleCellClick,
      addInning,
      removeInning,
      moveBatter,
      opponentName,
      setOpponentName,
      isAddingTeam,
      setIsAddingTeam,
      newTeamName,
      setNewTeamName,
      openAddPlayer,
      viewingPlayerId,
      setViewingPlayerId,
      openPlayerProfile,
      isAddingCoach,
      setIsAddingCoach,
      newCoachForm,
      setNewCoachForm,
      teamEvalGrades,
      setTeamEvalGrades,
      selectedRoundId,
      setSelectedRoundId,
    }),
    [
      modal,
      selectedGameId,
      isAddingGame,
      newGameForm,
      scoringGameId,
      activeTab,
      inGameId,
      inGameInning,
      inGameSelection,
      inGameUndoStack,
      currentGameAttendance,
      firstInningLineup,
      lineup,
      battingLineup,
      lineupQualityPenalty,
      tournamentPlan,
      swapSelection,
      gameSaved,
      handleCellClick,
      addInning,
      removeInning,
      moveBatter,
      opponentName,
      isAddingTeam,
      newTeamName,
      openAddPlayer,
      viewingPlayerId,
      openPlayerProfile,
      isAddingCoach,
      newCoachForm,
      teamEvalGrades,
      selectedRoundId,
    ],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};
