import type { Page } from "@playwright/test";

// Shared by the browser-check specs: the list of screens, and the rule that
// nothing leaves the machine.

export interface Screen {
  name: string;
  path: string;
  // Where the URL should end up, when that isn't `path` itself.
  settlesAt?: string;
  // Text that proves the screen rendered, for the one screen that draws as a
  // full-screen overlay instead of inside the page's main area.
  overlayShows?: RegExp;
}

export const SCREENS: Screen[] = [
  { name: "Home", path: "/" },
  { name: "Roster", path: "/roster" },
  { name: "Add player", path: "/roster/new" },
  // The profile canonicalises a player id to a name slug.
  {
    name: "Player profile",
    path: "/roster/p1",
    settlesAt: "/roster/mason-alvarez",
  },
  { name: "Schedule", path: "/schedule" },
  { name: "Game editor, upcoming game", path: "/schedule/game/u1" },
  { name: "Game editor, played game", path: "/schedule/game/g1" },
  { name: "Lineup view", path: "/schedule/game/g1/lineup" },
  { name: "Live game", path: "/in-game/g1", overlayShows: /inning/i },
  { name: "Week planner", path: "/schedule/week" },
  { name: "Tournament", path: "/schedule/tournaments/tn2" },
  { name: "Schedule import", path: "/schedule/import" },
  { name: "GameChanger import", path: "/schedule/import/gamechanger" },
  { name: "Stats", path: "/stats" },
  { name: "Stats trends", path: "/stats/trends" },
  { name: "Practices", path: "/practices" },
  { name: "Depth chart", path: "/depth-chart" },
  { name: "Evaluation", path: "/evaluation" },
  { name: "Tryouts", path: "/tryouts" },
  { name: "Families", path: "/families" },
  { name: "Availability", path: "/availability" },
  { name: "Finances", path: "/finances" },
  { name: "Settings", path: "/settings" },
  { name: "Settings, team", path: "/settings/team" },
  { name: "Help", path: "/help" },
  { name: "Playing time", path: "/playing-time" },
  { name: "Season report", path: "/season-report" },
  { name: "Awards", path: "/awards" },
  { name: "What-if lineup", path: "/lineup/what-if" },
  { name: "Home, as an assistant", path: "/?role=assistant" },
  { name: "Roster, as an assistant", path: "/roster?role=assistant" },
  // A head-only page sends an assistant Home — once, not in a loop.
  {
    name: "Settings, as an assistant",
    path: "/settings?role=assistant",
    settlesAt: "/",
  },
];

// Nothing leaves the machine: no Firebase, no analytics. The sample team is in
// memory, so the app needs none of it.
export const blockOutsideRequests = (page: Page) =>
  page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/_vercel/"))
      return route.fulfill({ contentType: "text/javascript", body: "" });
    return url.hostname === "localhost" ? route.continue() : route.abort();
  });
