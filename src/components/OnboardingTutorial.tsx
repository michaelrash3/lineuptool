import React, { useMemo } from "react";
import { Icons } from "../icons";
import { useTeam, useUI } from "../contexts";
import { APP_NAME, getLocalDateString } from "../constants/ui";
import { featureEnabled } from "../constants/features";
import { TourModal, attachStepNumbers, type TourStep } from "./help/TourModal";

// v3 → v4: the tour grew from a 9-step quickstart into the full Orientation
// Guide — chaptered coverage of every module (stats & season analytics, depth
// chart, practices, parent portals, finances, season rollover, the help
// center), skipping chapters the current role can't reach or the team has
// switched off. Bumping the key replays it once for existing coaches so
// nobody misses the new orientation; it stays one-click skippable.
const STORAGE_KEY = "lineuptool.onboardingComplete.v4";

export const onboardingHasBeenCompleted = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const markOnboardingComplete = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
};

interface OrientationCtx {
  hasPlayers: boolean;
  hasGames: boolean;
  hasGameToday: boolean;
  isAssistant: boolean;
  featureOn: (id: string) => boolean;
  setActiveTab: (tab: string) => void;
  // Routes to the /roster/new page (which also lands on the roster tab).
  openAddPlayer: () => void;
  setIsAddingGame?: (v: boolean) => void;
}

// Every chapter of the orientation. Steps are filtered per role/feature
// BEFORE numbering (attachStepNumbers), so "Step N of M" always reflects the
// chapters this coach can actually see. A null entry = chapter skipped.
const buildSteps = (ctx: OrientationCtx): TourStep[] => {
  const {
    hasGameToday,
    hasPlayers,
    hasGames,
    isAssistant,
    featureOn,
    setActiveTab,
    openAddPlayer,
    setIsAddingGame,
  } = ctx;
  const steps: Array<TourStep | null> = [
    {
      eyebrow: "Welcome",
      title: APP_NAME,
      icon: Icons.HomePlate,
      body: "Lineups, in-game swaps, eval rounds, tryouts, season analytics, finances — your whole season in one place. This orientation walks through every module; each step pushes you to actually do the thing. Replay it anytime from Help & Tutorials.",
    },
    isAssistant
      ? null
      : {
          numbered: true,
          title: "Set up your team",
          icon: Icons.Settings,
          body: "Open Settings to set the team name, age group, league rules, and pitching format. These drive every recommendation downstream. You can also set team colors, upload a logo, and switch off modules you don't need.",
          cta: [
            {
              label: "Go to Settings",
              primary: true,
              run: () => setActiveTab("settings"),
            },
          ],
        },
    {
      numbered: true,
      title: "Add your players",
      icon: Icons.UserPlus,
      body: hasPlayers
        ? "Roster is started. You can keep adding players one at a time, or bulk-import from a CSV."
        : "Two ways: add players one at a time on the Roster tab, or import a CSV from GameChanger / TeamSnap in Settings. Set each kid's comfortable positions and catcher flag — the lineup engine leans on them.",
      cta: isAssistant
        ? [
            {
              label: "Open Roster",
              primary: true,
              run: () => setActiveTab("roster"),
            },
          ]
        : [
            {
              label: "Add a player",
              primary: true,
              run: () => openAddPlayer(),
            },
            {
              label: "Import a CSV",
              run: () => setActiveTab("settings"),
            },
          ],
    },
    isAssistant || !featureOn("tryouts")
      ? null
      : {
          numbered: true,
          title: "Recruit with tryouts & interest",
          icon: Icons.Users,
          body: "Settings → Tryouts gives you two shareable links (with downloadable QR codes for flyers): a year-round Player Interest survey, and per-date tryout signup forms. Signups land in the Tryouts tab where you can grade, take attendance, and project your roster.",
          cta: [
            {
              label: "Set up tryouts",
              primary: true,
              run: () => setActiveTab("settings"),
            },
          ],
        },
    {
      numbered: true,
      title: "Add a game",
      icon: Icons.Calendar,
      body: "Schedule tab → Add Game. Pick the date and opponent. Flag a game as a Big Game ⭐ when you want primary-position-only fielding; otherwise Fair mode rotates kids through the positions they're comfortable playing. Mark scrimmages so they stay out of the record and stats.",
      cta: [
        {
          label: "Go to Schedule",
          primary: true,
          run: () => {
            setActiveTab("schedule");
            setIsAddingGame?.(true);
          },
        },
      ],
    },
    {
      numbered: true,
      title: "Generate a lineup",
      icon: Icons.Clipboard,
      body: "Open a scheduled game and tap Generate. The engine fills positions inning-by-inning with season-long bench + position fairness, the catcher inning cap, pitch-eligibility rules, scarcity-aware ordering, and Big Game rules when flagged. Lock any cell to pin a kid; print or export the card when it's right.",
      cta: hasGames
        ? [
            {
              label: "Open Schedule",
              primary: true,
              run: () => setActiveTab("schedule"),
            },
          ]
        : null,
    },
    {
      numbered: true,
      title: "Run In-Game mode",
      icon: Icons.Forward,
      body: "On gameday, tap Start Game on the Home dashboard. Tap any cell to swap players; the red Alert button handles mid-game injuries and re-balances the remaining innings automatically.",
      cta: hasGameToday
        ? [
            {
              label: "Go to Home",
              primary: true,
              run: () => setActiveTab("home"),
            },
          ]
        : null,
    },
    {
      numbered: true,
      title: "Save score & evaluate",
      icon: Icons.FileText,
      body: "After a game: enter the score (Home or Schedule), then open Evaluation to grade players on the 1–5 scale. Eval rounds are due on a set calendar cadence; trends, leaderboards, the Bench Equity tile, and Roster Decisions all refresh instantly.",
      cta: [
        {
          label: "Open Evaluation",
          primary: true,
          run: () => setActiveTab("evaluation"),
        },
      ],
    },
    !featureOn("stats")
      ? null
      : {
          numbered: true,
          title: "Track stats & season analytics",
          icon: Icons.Chart,
          body: "Import GameChanger CSVs — season-wide in Settings, or per-game from a finalized game — and the Stats tab lights up: sortable stat tables, Recent Form, Bench Equity, and Position Variety on the Overview, plus Season Trends (run differential, rolling win %) and Development (who's improving, steady, or declining across batting, evals, and position variety).",
          cta: [
            {
              label: "Open Stats",
              primary: true,
              run: () => setActiveTab("stats"),
            },
          ],
        },
    !featureOn("depthChart")
      ? null
      : {
          numbered: true,
          title: "Check the depth chart",
          icon: Icons.Glove,
          body: "The Depth Chart auto-ranks your kids at every position from eval grades and actual reps, so you can spot thin spots before they bite you in a bracket game.",
          cta: [
            {
              label: "Open Depth Chart",
              primary: true,
              run: () => setActiveTab("depthChart"),
            },
          ],
        },
    !featureOn("practices")
      ? null
      : {
          numbered: true,
          title: "Plan practices",
          icon: Icons.Clock,
          body: "Schedule practices, take attendance, and build plans from the drill library. Practice attendance feeds each kid's development report right alongside games.",
          cta: [
            {
              label: "Open Practices",
              primary: true,
              run: () => setActiveTab("practices"),
            },
          ],
        },
    isAssistant || !(featureOn("availability") || featureOn("playerInfo"))
      ? null
      : {
          numbered: true,
          title: "Let parents do the paperwork",
          icon: Icons.Link,
          body: "Share links (with QR codes) let families submit absences to the Availability calendar and sizing/logistics to the Player Info inbox — no accounts needed. Known absences auto-mark kids out on game day so lineups start from reality.",
          cta: [
            {
              label: featureOn("availability")
                ? "Open Availability"
                : "Open Player Info",
              primary: true,
              run: () =>
                setActiveTab(
                  featureOn("availability") ? "availability" : "playerInfo",
                ),
            },
          ],
        },
    isAssistant || !featureOn("finances")
      ? null
      : {
          numbered: true,
          title: "Track the money",
          icon: Icons.Wallet,
          body: "Budget, team fees, payment tracking, and a full ledger live in Finances — head coach only. Log expenses as they happen and print the treasurer report for the parent meeting.",
          cta: [
            {
              label: "Open Finances",
              primary: true,
              run: () => setActiveTab("finances"),
            },
          ],
        },
    isAssistant
      ? null
      : {
          numbered: true,
          title: "Advance the season",
          icon: Icons.Refresh,
          body: "When the season wraps, Settings → Advance Season archives every player's stats plus a development summary (positions played, eval growth, attendance), promotes accepted tryouts, and starts the new season clean. Year-over-year growth then shows up in each kid's development report.",
          cta: [
            {
              label: "Go to Settings",
              primary: true,
              run: () => setActiveTab("settings"),
            },
          ],
        },
    {
      eyebrow: "All Set",
      title: "You're ready",
      icon: Icons.Check,
      body: "⌘K / Ctrl-K opens the command palette from anywhere. The ? button (or the ? key) opens Help & Tutorials — searchable how-tos for every screen, a glossary, keyboard shortcuts, and guided tours you can run anytime, including this orientation.",
    },
  ];
  return steps.filter((s): s is TourStep => s !== null);
};

// The full-app Orientation Guide. Auto-opens once per device on first sign-in
// (see the effect in App.tsx) and replays from Help & Tutorials or the ? FAB.
export const OnboardingTutorial = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const { team, currentRole } = useTeam();
  const ui = useUI();

  // Re-derived each render so chapters pick up current role, feature
  // switches, and player/game counts.
  const steps = useMemo(() => {
    // Local calendar day, not UTC — an evening game must still count as
    // "today" for the in-game chapter's CTA.
    const today = getLocalDateString();
    const games = team?.games || [];
    const players = team?.players || [];
    const isAssistant = currentRole === "assistant";
    return attachStepNumbers(
      buildSteps({
        hasPlayers: players.length > 0,
        hasGames: games.length > 0,
        hasGameToday: games.some(
          (g: any) =>
            g.date === today &&
            g.status !== "final" &&
            g.status !== "postponed",
        ),
        isAssistant,
        featureOn: (id: string) => featureEnabled(team, id),
        setActiveTab: ui.setActiveTab,
        // Add-flows are head-coach actions (their editors are role-gated at
        // the destination); assistant CTAs navigate without the editor flag.
        openAddPlayer: isAssistant ? () => {} : ui.openAddPlayer,
        setIsAddingGame: isAssistant ? () => {} : ui.setIsAddingGame,
      }),
    );
  }, [team, currentRole, ui]);

  // Any exit — Done, Skip, Escape, or a CTA jump — counts as "seen": the
  // guide should never re-open itself on the next visit (same contract the
  // v3 tour had).
  const close = () => {
    markOnboardingComplete();
    onClose && onClose();
  };

  return <TourModal open={open} onClose={close} steps={steps} />;
};
