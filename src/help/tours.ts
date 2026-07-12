// Guided tours: action-oriented walkthroughs of the app's bigger flows,
// rendered by TourModal. Pure data — no React rendering here. Steps are
// built per-open (buildSteps) so copy and CTAs can react to current team
// state; numbering the steps is the caller's job (attachStepNumbers).

import type { ComponentType } from "react";
import { Icons } from "../icons";
import type { TourCtaCtx, TourStep } from "../components/help/TourModal";
import { featureEnabled, TeamFeatureId } from "../constants/features";

export interface Tour {
  id: string;
  title: string;
  description: string;
  icon: ComponentType<any>;
  // Hidden from assistant coaches (required when a step's CTA targets a
  // head-only tab).
  headOnly?: boolean;
  // Hidden when the team has this feature toggled off in Settings.
  featureId?: TeamFeatureId;
  buildSteps: (ctx: TourCtaCtx) => TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: "first-lineup",
    title: "Build your first lineup",
    description:
      "From an empty roster to a printed lineup card and game-day swaps.",
    icon: Icons.Clipboard,
    buildSteps: (ctx) => [
      {
        numbered: true,
        title: "Add your players",
        icon: Icons.UserPlus,
        body: ctx.hasPlayers
          ? "Your roster is started. Keep adding players one at a time on the Roster tab, or bulk-import a TeamSnap / GameChanger CSV in Settings. Comfortable positions and the catcher flag can come later."
          : "Roster tab → Add Player. A name is all you need to start — jersey number, comfortable positions, and the catcher flag can come later. Have a spreadsheet? Import a TeamSnap / GameChanger CSV in Settings instead.",
        cta: [
          {
            label: "Add a player",
            primary: true,
            // /roster/new is a routed page; navigating there also lands on
            // the roster tab.
            run: () => ctx.openAddPlayer(),
          },
        ],
      },
      {
        numbered: true,
        title: "Add a game",
        icon: Icons.Calendar,
        body: "Schedule tab → Add Game. Date and opponent are enough; time, location, and game type make the schedule and pitching plans smarter.",
        cta: [
          {
            label: "Add a game",
            primary: true,
            run: () => {
              ctx.setActiveTab("schedule");
              ctx.setIsAddingGame?.(true);
            },
          },
        ],
      },
      {
        numbered: true,
        title: "Mark who's out, then Generate",
        icon: Icons.Clipboard,
        body: "Open the game, bench anyone who's absent, and tap Generate. The engine fills positions inning by inning with season-long bench and position fairness, the catcher cap, and pitch eligibility. Star a Big Game ⭐ and it fields primary/secondary positions only.",
        cta: ctx.hasGames
          ? [
              {
                label: "Open Schedule",
                primary: true,
                run: () => ctx.setActiveTab("schedule"),
              },
            ]
          : null,
      },
      {
        numbered: true,
        title: "Save and print the card",
        icon: Icons.Printer,
        body: "Happy with it? Save, then export the lineup card as a PDF — batting order plus the inning-by-inning grid, ready for the dugout fence or a text to your assistants.",
      },
      {
        numbered: true,
        title: "Run In-Game mode on game day",
        icon: Icons.Forward,
        body: "Tap Start Game on the Home dashboard. Tap any cell to swap players live; the red Alert button handles a mid-game injury and re-balances the remaining innings automatically.",
        cta: ctx.hasGameToday
          ? [
              {
                label: "Go to Home",
                primary: true,
                run: () => ctx.setActiveTab("home"),
              },
            ]
          : null,
      },
    ],
  },
  {
    id: "run-tryouts",
    title: "Run a tryout",
    description:
      "Publish dates, grade at stations, rank the field, and build next season's roster.",
    icon: Icons.UserPlus,
    headOnly: true,
    featureId: "tryouts",
    buildSteps: (ctx) => [
      {
        numbered: true,
        title: "Set dates and share the signup link",
        icon: Icons.Link,
        body: "Settings → Tryouts: add your tryout dates and you get a public signup link with a downloadable QR code for flyers. Parents sign up without an account; the tryouts-open switch controls when intake closes.",
        cta: [
          {
            label: "Set up tryouts",
            primary: true,
            run: () => ctx.setActiveTab("settings"),
          },
        ],
      },
      {
        numbered: true,
        title: "Grade at the stations",
        icon: Icons.Edit,
        body: "On tryout day, take attendance and grade kids station by station. Each signup gets a tryout number, so graders never need to know names.",
        cta: [
          {
            label: "Open Tryouts",
            primary: true,
            run: () => ctx.setActiveTab("tryouts"),
          },
        ],
      },
      {
        numbered: true,
        title: "Rank the field and make offers",
        icon: Icons.Chart,
        body: "Station scores roll up into the ranking board. Combine it with your returning players to project next season's roster, and mark signups accepted as offers go out.",
      },
      {
        numbered: true,
        title: "Promote accepts to the roster",
        icon: Icons.Users,
        body: "Accepted signups carry into the Advance Season wizard automatically — promote them and they join the new season's roster with no retyping.",
      },
    ],
  },
  {
    id: "import-stats",
    title: "Import stats from GameChanger",
    description:
      "Bring your GameChanger numbers in and light up every analytics view.",
    icon: Icons.Upload,
    headOnly: true,
    featureId: "stats",
    buildSteps: (ctx) => [
      {
        numbered: true,
        title: "Export the CSV from GameChanger",
        icon: Icons.Download,
        body: "In GameChanger, export your team's stats as a CSV. The season export and a single game's box score use the same format, and this app reads both.",
      },
      {
        numbered: true,
        title: "Import the season file in Settings",
        icon: Icons.Upload,
        body: "Settings → import the CSV. Rows match your roster by name, and re-uploading the same file updates stats in place — no duplicate kids.",
        cta: [
          {
            label: "Open Settings",
            primary: true,
            run: () => ctx.setActiveTab("settings"),
          },
        ],
      },
      {
        numbered: true,
        title: "Attach box scores per game",
        icon: Icons.FileText,
        body: "Upload the same format from a game's editor to attach its box score. Per-game lines are what power bench equity, position variety, and development trends — season totals alone can't say who sat when.",
      },
      {
        numbered: true,
        title: "See what refreshes",
        icon: Icons.TrendingUp,
        body: "Every import instantly refreshes the stat tables, recent form, bench equity, position variety, and each player's development trends.",
        cta: [
          {
            label: "Open Stats",
            primary: true,
            run: () => ctx.setActiveTab("stats"),
          },
        ],
      },
    ],
  },
  {
    id: "advance-season",
    title: "Advance to a new season",
    description: "Archive this season per player and start the next one clean.",
    icon: Icons.Refresh,
    headOnly: true,
    buildSteps: (ctx) => [
      {
        numbered: true,
        title: "Know when to advance",
        icon: Icons.Calendar,
        body: "Run Advance Season once the season is wrapped and tryout offers are settled — it's the line between this year's books and next year's.",
      },
      {
        numbered: true,
        title: "What's archived vs. cleared",
        icon: Icons.Save,
        body: "Archived: each player's season stats plus a development summary (games played, attendance rate, evaluation start/end scores, innings by position) and the team's record — that history powers the year-over-year views. Cleared: games and practices reset for the new season.",
      },
      {
        numbered: true,
        title: "Set returning flags",
        icon: Icons.Users,
        body: "Mark every player Returning or Released in one pass. Accepted tryout signups are locked in already and promote onto the new roster.",
      },
      {
        numbered: true,
        title: "Run it from Settings",
        icon: Icons.Settings,
        body: "Settings → Advance Season opens the two-step wizard: review the summary, confirm, and you're on a clean slate with history preserved.",
        cta: [
          {
            label: "Open Settings",
            primary: true,
            run: () => ctx.setActiveTab("settings"),
          },
        ],
      },
    ],
  },
];

// The tours a given viewer should see: assistants lose headOnly tours, and a
// feature toggled off in Settings takes its tour with it (same rules as
// visibleHelpTopics).
export const visibleTours = (
  team: { disabledFeatures?: string[] } | null | undefined,
  role: string | null | undefined,
): Tour[] =>
  TOURS.filter(
    (t) =>
      !(t.headOnly && role === "assistant") &&
      (!t.featureId || featureEnabled(team, t.featureId)),
  );
