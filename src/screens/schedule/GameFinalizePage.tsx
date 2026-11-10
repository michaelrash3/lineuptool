import React, { memo } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { ScoreEditor } from "../ScheduleTab";
import type { Game } from "../../types";

// /schedule/game/:gameId/final — enter the final score and end the game.
// Converted from the In-Game "End Game" overlay per the app-wide
// modals→pages rule. Reached from the in-game footer; navigating here ends
// in-game mode (the route mirror clears inGameId), and Cancel's history
// back re-enters it — so an accidental tap costs nothing.
export const GameFinalizePage = memo(() => {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { team, currentRole, finalizeGame, updateGame } = useTeam();
  const back = useBackOrFallback("/schedule");
  const game: Game | undefined = (team.games || []).find(
    (g: Game) => g.id === gameId,
  );

  if (!game || currentRole === "assistant") {
    return <Navigate to="/schedule" replace />;
  }

  return (
    <PageShell
      eyebrow={`vs. ${game.opponent || "Opponent"}`}
      title="Final Score"
      onBack={back}
    >
      {/* Pitch counts come from the In-Game counter (saved as this game's
          outing) or the imported GameChanger box score, which replaces it. */}
      <div className="cc-card overflow-hidden">
        <ScoreEditor
          game={game}
          primaryColor={team.primaryColor}
          tertiaryColor={team.tertiaryColor}
          onSave={(ts: number, os: number, inningsPlayed: number) => {
            finalizeGame(game.id, ts, os, inningsPlayed);
            // The game is over — land on the schedule, not back in-game.
            navigate("/schedule", { replace: true });
          }}
          onClear={() => {
            updateGame(game.id, {
              teamScore: null,
              opponentScore: null,
              status: "scheduled",
            });
            back();
          }}
          onCancel={back}
        />
      </div>
    </PageShell>
  );
});
