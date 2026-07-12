import React, { memo, useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTeam } from "../../contexts";
import { PageShell } from "../../components/PageShell";
import { useBackOrFallback } from "../../hooks/usePageNav";
import { RoundComparisonView } from "./panels";
import { headEvalRounds, isDepartedPlayer } from "../../utils/helpers";
import { handGradedCategoriesForTeam } from "../../constants/ui";
import type { EvalRound } from "../../utils/evalScoring";
import type { Player } from "../../types";

// /evaluation/compare — any two saved rounds side by side. Converted from
// the RoundComparisonView overlay per the app-wide modals→pages rule.
// Needs at least two of the head's own rounds; otherwise (and for
// assistants) it lands back on the evaluation tab.
export const EvalComparePage = memo(() => {
  const navigate = useNavigate();
  const { team, user, currentRole } = useTeam();
  const back = useBackOrFallback("/evaluation");

  const rounds = useMemo(
    () =>
      headEvalRounds((team.evaluationEvents || []) as EvalRound[], user?.uid),
    [team.evaluationEvents, user?.uid],
  );
  // Jersey-number order, same as the eval workspace's grading cards.
  const players = useMemo(() => {
    return ((team.players || []) as Player[])
      .filter((p) => !isDepartedPlayer(p))
      .slice()
      .sort((a, b) => {
        const na = parseInt(String(a.number ?? ""), 10);
        const nb = parseInt(String(b.number ?? ""), 10);
        const aValid = Number.isFinite(na);
        const bValid = Number.isFinite(nb);
        if (aValid && bValid) {
          if (na !== nb) return na - nb;
        } else if (aValid) return -1;
        else if (bValid) return 1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [team.players]);
  const activeCategories = useMemo(
    () => handGradedCategoriesForTeam(team.pitchingFormat),
    [team.pitchingFormat],
  );

  if (currentRole === "assistant" || rounds.length < 2) {
    return <Navigate to="/evaluation" replace />;
  }

  return (
    <PageShell eyebrow="Round Comparison" title="Side By Side" onBack={back}>
      <RoundComparisonView
        rounds={rounds}
        players={players}
        activeCategories={activeCategories}
        onPlayerClick={(id: string) => navigate(`/evaluation/trend/${id}`)}
      />
    </PageShell>
  );
});
