// Stands in for src/providers/TeamProvider in the browser check. It provides
// the same two contexts with a signed-in head coach (or assistant, with
// ?role=assistant) and a sample team held in memory, so every screen renders
// without Firebase. Edits made through updateTeam / updateTeamArrays apply to
// that in-memory team; every other action is a no-op that logs its name.
//
// This is deliberately NOT the real provider: loading, sync, permissions and
// the Firestore rules are covered by the unit suite and the rules emulator
// suite, not here. What this buys is the real shell, routing, layout and
// screens in a real browser.
import React, { useCallback, useMemo, useRef, useState } from "react";
import { TeamContext, TeamActionsContext } from "../../src/contexts";
import { applyTeamArrayUpdate } from "../../src/utils/teamArrayUpdates";
import type { CoachRole, Game } from "../../src/types";
import { buildSampleTeam } from "./sampleTeam";
// The real provider's source, read as text only to learn the NAMES of the
// actions it exposes — useTeam() spreads the actions object, so every name a
// screen destructures has to exist as an own key (a Proxy can't supply that).
import realProviderSource from "../../src/providers/TeamProvider.tsx?raw";

const ACTION_NAMES: string[] = (() => {
  const start = realProviderSource.indexOf("const actionsValue = useMemo(");
  const end = realProviderSource.indexOf("}),", start);
  const names = new Set<string>();
  for (const m of realProviderSource
    .slice(start, end)
    .matchAll(/^\s{6}([A-Za-z_][A-Za-z0-9_]*)\s*[,:]/gm))
    names.add(m[1]);
  return [...names];
})();
// If the real provider is reshaped so the scan above finds nothing, fail the
// whole run with a clear message instead of rendering screens whose actions
// are silently undefined.
if (
  ACTION_NAMES.length < 50 ||
  !["updateTeam", "addPlayer", "regenerateLineup", "updateGame"].every((n) =>
    ACTION_NAMES.includes(n),
  )
) {
  throw new Error(
    `MockTeamProvider found only ${ACTION_NAMES.length} action names in TeamProvider.tsx — update the scan in e2e/harness/MockTeamProvider.tsx`,
  );
}

const role: CoachRole =
  new URLSearchParams(window.location.search).get("role") === "assistant"
    ? "assistant"
    : "head";

const blankRecord = () => ({
  wins: 0,
  losses: 0,
  ties: 0,
  runsScored: 0,
  runsAllowed: 0,
});

export const TeamProvider = ({ children }: { children: React.ReactNode }) => {
  const [team, setTeam] = useState<any>(() => buildSampleTeam());
  const [genError, setGenError] = useState("");
  const uiBridge = useRef<any>({});

  const updateTeam = useCallback(
    (patch: Record<string, unknown>) =>
      setTeam((t: any) => ({ ...t, ...patch })),
    [],
  );
  const updateTeamArrays = useCallback((input: any) => {
    setTeam((t: any) =>
      (Array.isArray(input) ? input : [input]).reduce(
        (acc: any, update: any) => applyTeamArrayUpdate(acc, update),
        t,
      ),
    );
  }, []);

  const record = useMemo(() => {
    const all = blankRecord();
    for (const g of team.games as Game[]) {
      if (g.status !== "final" || g.isScrimmage) continue;
      const us = Number(g.teamScore);
      const them = Number(g.opponentScore);
      if (Number.isNaN(us) || Number.isNaN(them)) continue;
      all.runsScored += us;
      all.runsAllowed += them;
      if (us > them) all.wins++;
      else if (us < them) all.losses++;
      else all.ties++;
    }
    return { ...all, byFormat: { kidPitch: all, machine: blankRecord() } };
  }, [team.games]);

  const data = useMemo(
    () => ({
      team,
      teams: [{ id: "team-sample", name: team.name, role }],
      activeTeamId: "team-sample",
      user: {
        uid: "coach-sample",
        displayName: "Coach Sample",
        email: "coach@example.com",
        photoURL: "",
      },
      authReady: true,
      syncStatus: "",
      loading: false,
      needsWelcomeChooser: false,
      genError,
      setGenError,
      record,
      currentRole: role,
      roleResolved: true,
      realRole: role,
      viewAsRole: null,
      setViewAsRole: () => {},
      uiBridge,
      dismissLineupUndoToast: () => {},
      mirrorStale: false,
      resyncPublicMirror: async () => {},
      signupsReady: true,
      signupsDenied: false,
      gamesServerConfirmed: true,
      teamDocServerConfirmed: true,
    }),
    [team, genError, record],
  );

  const actions = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const name of ACTION_NAMES) {
      out[name] = () => {
        console.info(`[browser check] action not simulated: ${name}`);
        return undefined;
      };
    }
    out.updateTeam = updateTeam;
    out.updateTeamArrays = updateTeamArrays;
    return out;
  }, [updateTeam, updateTeamArrays]);

  return (
    <TeamContext.Provider value={data as any}>
      <TeamActionsContext.Provider value={actions as any}>
        {children}
      </TeamActionsContext.Provider>
    </TeamContext.Provider>
  );
};
