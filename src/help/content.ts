// Single source of truth for the in-app Help Center: category taxonomy,
// topic articles, search ranking, and role/feature visibility. Pure data +
// pure functions — no React. The HelpCenter overlay renders from this, the
// command palette deep-links into it, and content.test.ts enforces the
// referential integrity rules (related ids resolve, CTA tabs are real,
// head-only/feature gates match their CTA targets).

import { fuzzyScore } from "../utils/fuzzy";
import { featureEnabled, TeamFeatureId } from "../constants/features";

export type HelpCategoryId =
  | "getting-started"
  | "roster"
  | "schedule-games"
  | "lineups"
  | "in-game"
  | "evaluations"
  | "tryouts-recruiting"
  | "stats-analytics"
  | "practices"
  | "finances"
  | "parent-portals"
  | "settings-team"
  | "shortcuts"
  | "glossary";

export interface HelpCategory {
  id: HelpCategoryId;
  label: string;
  blurb: string;
  // Key into the Icons record (src/icons.tsx).
  icon: string;
}

export interface HelpSection {
  heading?: string;
  body: string;
  list?: string[];
}

export interface HelpCta {
  label: string;
  // Must be a key of TAB_TO_PATH (useMainShellRouting).
  tab: string;
  uiAction?: "addPlayer" | "addGame";
}

export interface HelpTopic {
  id: string;
  category: HelpCategoryId;
  title: string;
  summary: string;
  // Search synonyms not worth spelling out in the visible copy.
  keywords: string;
  sections: HelpSection[];
  related?: string[];
  cta?: HelpCta;
  // Hidden from assistant coaches (required when cta targets a head-only tab).
  headOnly?: boolean;
  // Hidden when the team has this feature toggled off in Settings.
  featureId?: TeamFeatureId;
}

// Display order: getting-started first, glossary last.
export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    blurb: "What the app does and how to get a team up and running.",
    icon: "HomePlate",
  },
  {
    id: "roster",
    label: "Roster",
    blurb: "Players, positions, imports, and availability.",
    icon: "Users",
  },
  {
    id: "schedule-games",
    label: "Schedule & Games",
    blurb: "Games, game types, scores, and postponements.",
    icon: "Calendar",
  },
  {
    id: "lineups",
    label: "Lineups",
    blurb: "The generator, manual edits, batting order, and printing.",
    icon: "Clipboard",
  },
  {
    id: "in-game",
    label: "In-Game",
    blurb: "Game-day mode: swaps, injuries, and undo.",
    icon: "Forward",
  },
  {
    id: "evaluations",
    label: "Evaluations",
    blurb: "Grading rounds, trends, and what they feed.",
    icon: "FileText",
  },
  {
    id: "tryouts-recruiting",
    label: "Tryouts & Recruiting",
    blurb: "Signups, showcase grading, ranking, and interest leads.",
    icon: "UserPlus",
  },
  {
    id: "stats-analytics",
    label: "Stats & Analytics",
    blurb: "GameChanger imports, stat tables, trends, and development.",
    icon: "Chart",
  },
  {
    id: "practices",
    label: "Practices",
    blurb: "Practice schedule, attendance, and the drill library.",
    icon: "Glove",
  },
  {
    id: "finances",
    label: "Finances",
    blurb: "Budget, fees, the ledger, and treasurer reports.",
    icon: "Wallet",
  },
  {
    id: "parent-portals",
    label: "Parent Portals",
    blurb: "Public links parents use to send you information.",
    icon: "Link",
  },
  {
    id: "settings-team",
    label: "Settings & Team",
    blurb: "Identity, rules, coaches, feature toggles, and rollover.",
    icon: "Settings",
  },
  {
    id: "shortcuts",
    label: "Keyboard Shortcuts",
    blurb: "Every shortcut the app listens for.",
    icon: "Sparkles",
  },
  {
    id: "glossary",
    label: "Glossary",
    blurb: "Baseball stats and app terms, defined.",
    icon: "Book",
  },
];

export const HELP_TOPICS: HelpTopic[] = [
  // ------------------------------------------------------------ getting-started
  {
    id: "welcome",
    category: "getting-started",
    title: "What is The Bench Coach?",
    summary:
      "A youth-baseball coaching app: lineups, in-game swaps, evaluations, tryouts, and season stats in one place.",
    keywords: "about overview intro app bench coach lineuptool what is this",
    sections: [
      {
        body: "The Bench Coach builds inning-by-inning lineups with season-long fairness, runs game day with tap-to-swap and injury handling, and keeps evaluations, tryouts, practices, stats, and team finances in one team workspace.",
      },
      {
        heading: "Built for the whole staff",
        body: "Every coach on the team sees the same live data — changes sync in real time. Head coaches control settings, finances, and parent portals; assistant coaches get the roster, schedule, lineups, and their own evaluation submissions.",
      },
      {
        heading: "Works at the field",
        body: "It's a PWA: install it to your phone's home screen and it behaves like a native app. Everything you need on game day works from your pocket.",
      },
    ],
    related: ["first-season-checklist", "create-or-join-team"],
  },
  {
    id: "create-or-join-team",
    category: "getting-started",
    title: "Create a team vs. join one",
    summary:
      "Start a new team, or join an existing one with the 6-character code from your head coach.",
    keywords: "new team join code invite signup rec tournament nkb usssa",
    sections: [
      {
        heading: "Joining",
        body: "If your head coach already set the team up, ask for the 6-character join code and enter it on the welcome screen (or via Join Team in the header). You'll come in as an assistant coach.",
      },
      {
        heading: "Creating",
        body: "Starting fresh? Name your team and pick a type. Rec: everybody plays — fairness across the season. Tournament: competitive — best lineup, with a minimum-play floor. Both the name and the type can be changed later in Settings.",
      },
      {
        body: "One coach can belong to several teams; switch between them from the team dropdown in the header.",
      },
    ],
    related: ["invite-coaches", "first-season-checklist"],
  },
  {
    id: "first-season-checklist",
    category: "getting-started",
    title: "First-season checklist",
    summary: "The setup order that makes everything downstream work well.",
    keywords: "setup checklist start onboarding steps new season",
    sections: [
      {
        body: "Work through these once and the rest of the season mostly runs itself:",
        list: [
          "Settings: team name, age group, league rules, and pitching format — these drive every recommendation.",
          "Roster: add players (one at a time, or CSV import), then set comfortable positions and the catcher flag.",
          "Schedule: add your games; flag scrimmages and Big Games.",
          "Open a game and tap Generate for your first lineup.",
          "On game day, Start Game from Home for live swaps.",
          "Afterwards: save the score, then grade an evaluation round.",
        ],
      },
    ],
    related: ["add-players", "add-games", "lineup-generator"],
    cta: { label: "Open your roster", tab: "roster" },
  },
  {
    id: "command-palette-help",
    category: "getting-started",
    title: "Command palette & this Help Center",
    summary:
      "Cmd/Ctrl+K jumps anywhere; ? opens Help. Both search the same way.",
    keywords: "palette cmd k ctrl k search help center question mark docs",
    sections: [
      {
        heading: "Command palette",
        body: "Press Cmd+K (Mac) or Ctrl+K (Windows) anywhere — even inside a form field — to open the command palette. Type a few characters to jump to a tab, a game, or an action.",
      },
      {
        heading: "Help Center",
        body: "Press ? (Shift+/) to open this Help Center. Browse by category or search; matching your exact words in a title ranks highest. Topics are filtered to what you can actually see — assistant coaches and teams with features switched off won't find articles about tabs they don't have.",
      },
    ],
    related: ["keyboard-shortcuts"],
  },

  // ----------------------------------------------------------------- roster
  {
    id: "add-players",
    category: "roster",
    title: "Adding players",
    summary: "Add players one at a time on the Roster tab, or bulk-import.",
    keywords: "roster add player kid new player create jersey number",
    sections: [
      {
        body: "Roster tab → Add Player. Name is all you need to start; jersey number, birth date, positions, and the rest can come later.",
      },
      {
        body: "Have a spreadsheet already? Import the whole roster at once from a TeamSnap or GameChanger CSV instead of typing each kid in.",
      },
    ],
    related: ["roster-csv-import", "player-positions"],
    cta: { label: "Add a player", tab: "roster", uiAction: "addPlayer" },
  },
  {
    id: "roster-csv-import",
    category: "roster",
    title: "Importing a roster CSV",
    summary:
      "Bulk-create players from a TeamSnap members export or a GameChanger stats export.",
    keywords: "csv import teamsnap gamechanger upload bulk roster spreadsheet",
    sections: [
      {
        body: "Settings → import a CSV. Two formats are recognized automatically: a TeamSnap members export, and a GameChanger stats export (which creates players and loads their season stat lines in one pass).",
      },
      {
        body: "Rows are matched to existing players by name, so re-uploading the same file updates stats in place instead of duplicating kids. Unmatched rows become new players.",
      },
    ],
    related: ["add-players", "gamechanger-import"],
    headOnly: true,
    cta: { label: "Open Settings", tab: "settings" },
  },
  {
    id: "player-positions",
    category: "roster",
    title: "Positions, the catcher flag, and primary/secondary",
    summary:
      "The position fields on a player profile and how the lineup engine reads them.",
    keywords:
      "comfortable positions catcher flag primary secondary restrictions profile",
    sections: [
      {
        heading: "Comfortable positions",
        body: 'The positions you\'re comfortable playing this kid. Leave it empty to mean "anywhere." Fair-mode lineups rotate players only through their comfortable positions.',
      },
      {
        heading: "Catcher flag",
        body: "Catching is opt-in — equipment, continuity, and a smaller group of trained kids make C special. Only flagged players enter the catching rotation, and the generator caps their innings behind the plate.",
      },
      {
        heading: "Primary & secondary",
        body: "Your depth-chart picks for each player. In a Big Game the generator fields players at their primary (or secondary) positions only, instead of rotating for fairness.",
      },
    ],
    related: ["lineup-generator", "game-types-and-flags"],
    cta: { label: "Open Roster", tab: "roster" },
  },
  {
    id: "absences-departed",
    category: "roster",
    title: "Absences and departed players",
    summary:
      "Mark dates a player is out, and keep departed players' history without them cluttering lineups.",
    keywords: "absence unavailable vacation missing quit released departed",
    sections: [
      {
        heading: "Absences",
        body: "Add unavailable dates on a player's profile and the generator benches them for those games automatically. Parents can also submit dates through the Availability portal; their submissions merge onto the player's absence list.",
      },
      {
        heading: "Departed players",
        body: "When a player leaves mid-season, mark them departed instead of deleting them. They drop out of lineups and rotations, but their stats and evaluation history stay on the books.",
      },
    ],
    related: ["availability-portal", "season-rollover"],
    cta: { label: "Open Roster", tab: "roster" },
  },

  // --------------------------------------------------------- schedule-games
  {
    id: "add-games",
    category: "schedule-games",
    title: "Adding games",
    summary: "Schedule tab → Add Game: date, opponent, and any flags.",
    keywords: "schedule new game opponent add game calendar ics sync",
    sections: [
      {
        body: "Schedule tab → Add Game. Pick the date and opponent; time, location, and game type are optional but make the schedule and pitching plans smarter.",
      },
      {
        body: "Already keeping the schedule in GameChanger? Paste the team's calendar feed URL to sync games in — re-syncing updates dates and opponents in place and never touches scores or lineups on games already played.",
      },
    ],
    related: ["game-types-and-flags", "scores-postponements"],
    cta: { label: "Add a game", tab: "schedule", uiAction: "addGame" },
  },
  {
    id: "game-types-and-flags",
    category: "schedule-games",
    title: "Game types, scrimmages, and Big Games",
    summary:
      "League / pool / bracket types, the scrimmage flag, and the Big Game star.",
    keywords:
      "league pool bracket scrimmage exhibition big game star flag tournament",
    sections: [
      {
        heading: "Game type",
        body: "League, pool play, or bracket. For 9U+ tournament teams the type drives how many pitchers the engine plans for — bracket games get a deeper pitcher pool than pool play.",
      },
      {
        heading: "Scrimmage",
        body: "Flag exhibition games as scrimmages and they're excluded from your W-L record and season stats. Great for preseason reps without skewing the numbers.",
      },
      {
        heading: "Big Game",
        body: "Star a game as a Big Game when winning matters most: the generator fields players at their primary (or secondary) positions only, instead of rotating everyone for fairness.",
      },
    ],
    related: ["lineup-generator", "player-positions"],
    cta: { label: "Open Schedule", tab: "schedule" },
  },
  {
    id: "scores-postponements",
    category: "schedule-games",
    title: "Scores, your record, and postponements",
    summary:
      "Enter final scores from Home or Schedule; postponed games stay out of the record.",
    keywords: "final score win loss record rainout postponed cancel reschedule",
    sections: [
      {
        body: "After a game, enter the score from the Home dashboard or the Schedule tab. Finalized games drive your W-L record, run differential, and streak — scrimmages excluded.",
      },
      {
        body: "Rained out? Mark the game postponed. It keeps its slot on the schedule without counting anywhere, and you can set a new date when the league does.",
      },
      {
        body: "Saving a score also unlocks the evaluation prompt on Home, so grading the game while it's fresh is one tap away.",
      },
    ],
    related: ["eval-rounds", "season-trends"],
    cta: { label: "Open Schedule", tab: "schedule" },
  },

  // ---------------------------------------------------------------- lineups
  {
    id: "lineup-generator",
    category: "lineups",
    title: "How the lineup generator works",
    summary:
      "Season-long bench and position fairness, the catcher cap, pitch eligibility, and Big Game rules.",
    keywords:
      "generate lineup engine fairness rotation algorithm auto fill positions",
    sections: [
      {
        body: "Open a scheduled game and tap Generate. The engine fills positions inning by inning, balancing bench time and position variety across the whole season — not just this game — so nobody quietly accumulates extra sits.",
      },
      {
        body: "It also respects the hard rules for you:",
        list: [
          "Catcher inning cap — flagged catchers rotate behind the plate.",
          "Pitch eligibility — rest rules from your league's pitching format.",
          "Comfortable positions — kids only play where you said they can.",
          "Scarcity-aware ordering — thin positions get filled first.",
          "Big Game rules — primary/secondary positions only when starred.",
        ],
      },
      {
        body: "Don't like a result? Regenerate as often as you want (G on the keyboard), or lock the cells you're sure about first.",
      },
    ],
    related: ["lineup-locks-editing", "batting-order", "game-types-and-flags"],
    cta: { label: "Open Schedule", tab: "schedule" },
  },
  {
    id: "lineup-locks-editing",
    category: "lineups",
    title: "Locks, edits, and swaps",
    summary:
      "Lock cells you're sure about, then regenerate around them or swap by hand.",
    keywords: "lock pin edit cell swap manual change position override",
    sections: [
      {
        body: "Every cell in the lineup grid is editable. Tap a cell to change who's playing there; the editor shows who's eligible and warns you about conflicts instead of silently allowing them.",
      },
      {
        heading: "Locks",
        body: "Lock a cell to protect it — regeneration fills everything around your locks. Typical flow: pin your pitcher and catcher plan, then let the engine handle the other seven spots fairly.",
      },
    ],
    related: ["lineup-generator", "keyboard-shortcuts"],
  },
  {
    id: "batting-order",
    category: "lineups",
    title: "Batting order",
    summary: "Generated alongside the defense; reorder or regenerate anytime.",
    keywords: "batting order lineup hitters order bat b key continuous",
    sections: [
      {
        body: "Each game gets a batting order along with the defensive grid. Drag to reorder by hand, or regenerate it (B on the keyboard) without touching the fielding assignments.",
      },
      {
        body: "The order balances over the season too — kids who've been hitting at the bottom drift up in later games.",
      },
    ],
    related: ["lineup-generator", "lineup-card-export"],
  },
  {
    id: "lineup-card-export",
    category: "lineups",
    title: "Printing the lineup card",
    summary: "Export a game's lineup as a printable PDF card for the dugout.",
    keywords: "print pdf export lineup card dugout share paper",
    sections: [
      {
        body: "From a game's lineup view, export the lineup card as a PDF — batting order plus the inning-by-inning defensive grid, ready to print or text to your assistants for the dugout fence.",
      },
    ],
    related: ["batting-order", "in-game-mode"],
  },

  // ---------------------------------------------------------------- in-game
  {
    id: "in-game-mode",
    category: "in-game",
    title: "Running In-Game mode",
    summary:
      "Start from the Home dashboard on game day; tap any cell to swap live.",
    keywords: "game day live start game in game mode swap tap dugout",
    sections: [
      {
        body: "On game day, tap Start Game on the Home dashboard. In-Game mode is a full-screen view of the live lineup built for a phone in one hand.",
      },
      {
        heading: "Tap to swap",
        body: "Tap any defensive cell, then tap the player to swap in — a highlight ring marks the pending swap until you confirm. Changes sync instantly to every coach's device.",
      },
      {
        heading: "Finishing up",
        body: "Save & Finalize records the score, archives the lineup as played, and unlocks the evaluation prompt on Home.",
      },
    ],
    related: ["in-game-injury-undo", "scores-postponements"],
    cta: { label: "Go to Home", tab: "home" },
  },
  {
    id: "in-game-injury-undo",
    category: "in-game",
    title: "Injuries and undo",
    summary:
      "The Alert button re-balances the remaining innings after an injury; undo restores your last state.",
    keywords: "injury hurt alert rebalance remove player undo mistake revert",
    sections: [
      {
        heading: "Injury alert",
        body: "A kid goes down mid-game: tap the red Alert button, pick the player, and the engine removes them and re-balances the remaining innings automatically — fairness math is prorated so nobody else's season totals get distorted.",
      },
      {
        heading: "Undo",
        body: "Every swap takes a snapshot first. Fat-fingered the wrong cell? Undo restores the pre-swap state for the rest of the inning.",
      },
    ],
    related: ["in-game-mode"],
  },

  // ------------------------------------------------------------ evaluations
  {
    id: "eval-rounds",
    category: "evaluations",
    title: "Evaluation rounds",
    summary:
      "Grade every player 1–5 across hitting, fielding, or pitching dimensions on a set cadence.",
    keywords: "evaluate grade round 1-5 scale rating due date cadence notes",
    sections: [
      {
        body: "Evaluation tab → New Round. Pick a category set (hitting / fielding / pitching), then grade each player 1–5 per dimension with optional notes. Save and every leaderboard and sparkline recomputes instantly.",
      },
      {
        heading: "Cadence",
        body: "Rounds are due on a calendar cadence so grading stays a habit, not a year-end scramble. Home nudges you when a round is due, and consistent rounds are what make the trend lines meaningful.",
      },
    ],
    related: ["assistant-evals", "eval-trends"],
    cta: { label: "Open Evaluation", tab: "evaluation" },
  },
  {
    id: "assistant-evals",
    category: "evaluations",
    title: "Assistant coach evaluations",
    summary:
      "Assistants submit their own rounds; the head coach reviews and finalizes.",
    keywords: "assistant submit review finalize second opinion grading staff",
    sections: [
      {
        body: "Assistant coaches grade with the same 1–5 rounds from their own Evaluation view. Their submissions queue for the head coach, who reviews and finalizes before anything lands in the team's canonical evaluation history.",
      },
      {
        body: "More graders means less bias — an average across the staff is a fairer read on a kid than one coach's game-day mood.",
      },
    ],
    related: ["eval-rounds", "invite-coaches"],
    cta: { label: "Open Evaluation", tab: "evaluation" },
  },
  {
    id: "eval-trends",
    category: "evaluations",
    title: "Where evaluations show up",
    summary:
      "Trends, leaderboards, the depth chart, and the development view all read from your rounds.",
    keywords: "trend sparkline leaderboard score 100 depth chart feeds",
    sections: [
      {
        body: "Each player's rounds roll up into a 0–100 score and a trend sparkline. Those feed the Evaluation leaderboards, the Depth Chart's position rankings, roster decisions at season end, and the improving/steady/declining signal in the Development view.",
      },
      {
        body: "That's why cadence matters: two rounds make a line, six make a story.",
      },
    ],
    related: ["eval-rounds", "development-view"],
    cta: { label: "Open Evaluation", tab: "evaluation" },
  },

  // ----------------------------------------------------- tryouts-recruiting
  {
    id: "tryout-setup",
    category: "tryouts-recruiting",
    title: "Setting up tryouts",
    summary:
      "Publish tryout dates, share the public signup link or QR code, and control intake.",
    keywords: "tryout dates signup form public portal qr code flyer open close",
    sections: [
      {
        body: "Settings → Tryouts: add your tryout dates and you get a public signup link with a downloadable QR code for flyers. Parents sign up without an account; submissions land in the Tryouts tab.",
      },
      {
        heading: "Opening and closing intake",
        body: "The tryouts-open switch controls whether the public form accepts submissions. Turning the Tryouts feature off in Settings only hides the tab for coaches — close intake with the switch, not the feature toggle.",
      },
    ],
    related: ["tryout-grading", "share-links-qr"],
    featureId: "tryouts",
    cta: { label: "Open Tryouts", tab: "tryouts" },
  },
  {
    id: "tryout-grading",
    category: "tryouts-recruiting",
    title: "Grading tryouts and projecting the roster",
    summary:
      "Showcase stations, attendance, the ranking board, and next season's projection.",
    keywords:
      "showcase station grade rank board projection offer accept number",
    sections: [
      {
        body: "On tryout day, take attendance and grade kids station by station — each signup gets a tryout number so graders don't need names. Scores roll up into the ranking board.",
      },
      {
        heading: "Roster projection",
        body: "Combine the ranking board with your returning players to project next season's roster. Mark signups accepted as offers go out; accepted kids carry into the Advance Season wizard automatically.",
      },
    ],
    related: ["tryout-setup", "season-rollover"],
    featureId: "tryouts",
    cta: { label: "Open Tryouts", tab: "tryouts" },
  },
  {
    id: "interest-portal",
    category: "tryouts-recruiting",
    title: "The player interest portal",
    summary:
      "A year-round public survey that collects recruiting leads in the Interest tab.",
    keywords: "interest survey lead recruit year round public form pipeline",
    sections: [
      {
        body: "Beyond tryout season, the interest portal is a year-round shareable survey (with its own QR code) for families curious about your program. Leads collect in the Interest tab with contact info until you're ready to invite them to a tryout.",
      },
    ],
    related: ["tryout-setup", "share-links-qr"],
    featureId: "interest",
    headOnly: true,
    cta: { label: "Open Interest", tab: "interest" },
  },

  // -------------------------------------------------------- stats-analytics
  {
    id: "gamechanger-import",
    category: "stats-analytics",
    title: "Importing GameChanger stats",
    summary:
      "Upload season CSVs or per-game box scores; rows match your roster by name.",
    keywords: "gamechanger csv stats import box score season upload sync",
    sections: [
      {
        heading: "Season import",
        body: "Export the season stats CSV from GameChanger and upload it. Rows are matched to your roster by name, and re-uploading the same file updates in place — no duplicates.",
      },
      {
        heading: "Per-game import",
        body: "Upload the same CSV format for a single game to attach a box score to it. Per-game lines are what power bench equity, position variety, and the development trends — the season totals alone can't say who sat when.",
      },
    ],
    related: ["stat-tables", "bench-equity-variety"],
    featureId: "stats",
    cta: { label: "Open Stats", tab: "stats" },
  },
  {
    id: "stat-tables",
    category: "stats-analytics",
    title: "Stat tables and recent form",
    summary: "Season lines, leaders, and who's hot over the last few games.",
    keywords: "stats table leaders sort avg obp ops hot cold recent form",
    sections: [
      {
        body: "The Stats tab shows every player's season line — batting, fielding, and pitching — sortable by any column, plus leaderboards for the headline stats.",
      },
      {
        heading: "Recent form",
        body: "With per-game imports, recent form compares a player's last few games against their season line, so you can see who's heating up before the season averages catch up.",
      },
    ],
    related: ["gamechanger-import", "season-trends"],
    featureId: "stats",
    cta: { label: "Open Stats", tab: "stats" },
  },
  {
    id: "bench-equity-variety",
    category: "stats-analytics",
    title: "Bench equity and position variety",
    summary:
      "Who has sat more than their share, and who's been stuck at one position.",
    keywords:
      "bench equity extra sits fairness position variety rotation stuck",
    sections: [
      {
        heading: "Bench equity",
        body: "Computed from imported box scores — actual innings, not planned ones. It counts each player's extra sits beyond the game's fair minimum, so you can spot (and fix) a kid quietly riding the bench.",
      },
      {
        heading: "Position variety",
        body: "Innings logged per position, grouped into infield, outfield, and battery. Surfaces who's never seen the infield and who's been parked in right field, so the rotation can be evened out.",
      },
    ],
    related: ["lineup-generator", "gamechanger-import"],
    featureId: "stats",
    cta: { label: "Open Stats", tab: "stats" },
  },
  {
    id: "season-trends",
    category: "stats-analytics",
    title: "Season Trends",
    summary:
      "Team-level direction over time: run differential by game and rolling win percentage.",
    keywords: "trend chart run differential rolling win percentage team graph",
    sections: [
      {
        body: 'Season Trends charts the team\'s trajectory: run differential game by game and a rolling win percentage. It answers "are we actually getting better?" with a line instead of a feeling.',
      },
      {
        body: "Scrimmages and postponed games are excluded, same as the record. The more finalized games with scores, the better the picture.",
      },
    ],
    related: ["scores-postponements", "development-view"],
    featureId: "stats",
    cta: { label: "Open Stats", tab: "stats" },
  },
  {
    id: "development-view",
    category: "stats-analytics",
    title: "Player development",
    summary:
      "Improving / steady / declining signals per player, plus a shareable development report.",
    keywords:
      "development improving declining steady growth signal report progress",
    sections: [
      {
        body: "The Development view blends three signals per player — batting production, evaluation scores, and position variety — into an improving, steady, or declining read, so a kid trending down gets attention before the season ends.",
      },
      {
        heading: "Development report",
        body: "Each player also gets a development report: season stats, evaluation growth, attendance, year-over-year history from archived seasons, and your coach notes — ready to walk a parent through at the end-of-season conversation.",
      },
    ],
    related: ["eval-trends", "season-rollover"],
    featureId: "stats",
    cta: { label: "Open Stats", tab: "stats" },
  },

  // -------------------------------------------------------------- practices
  {
    id: "practices",
    category: "practices",
    title: "Practices, attendance, and drills",
    summary:
      "Schedule practices, track who showed up, and plan from the drill library.",
    keywords: "practice plan drill library attendance schedule reps",
    sections: [
      {
        heading: "Scheduling",
        body: "The Practices tab holds your practice calendar alongside the game schedule. Syncing a GameChanger calendar feed pulls practices in too.",
      },
      {
        heading: "Attendance",
        body: "Take attendance at each practice — it feeds each player's attendance rate, which shows up in the development report and the season archive.",
      },
      {
        heading: "Drills & plans",
        body: "Build practice plans from the drill library so an hour of field time doesn't get improvised on the drive over.",
      },
    ],
    related: ["development-view", "add-games"],
    featureId: "practices",
    cta: { label: "Open Practices", tab: "practices" },
  },

  // --------------------------------------------------------------- finances
  {
    id: "budget-fees",
    category: "finances",
    title: "Budget and team fees",
    summary:
      "Set the season budget, split fees per family, and track deposits and payments.",
    keywords: "money budget fees dues payment deposit family owed collect",
    sections: [
      {
        body: "The Finances tab tracks the season budget and per-family fees: who's paid, who's on a plan, and what's still owed. Deposits collected during offers (via the Advance Season flow) land here too.",
      },
      {
        body: "A printable fee sheet gives each family a clean statement instead of a text-message paper trail.",
      },
    ],
    related: ["ledger-treasurer", "season-rollover"],
    featureId: "finances",
    headOnly: true,
    cta: { label: "Open Finances", tab: "finances" },
  },
  {
    id: "ledger-treasurer",
    category: "finances",
    title: "The ledger and treasurer report",
    summary:
      "Categorized income and expenses, exportable for the league or the parents' meeting.",
    keywords: "ledger expense income category export treasurer report audit",
    sections: [
      {
        body: "Every dollar in or out goes in the ledger with a category — uniforms, tournament entries, field rentals, fundraising. The running balance updates as you go.",
      },
      {
        heading: "Treasurer report",
        body: 'Export a treasurer report summarizing the season by category — the answer to "where did the money go?" at the parents\' meeting, in one page.',
      },
    ],
    related: ["budget-fees"],
    featureId: "finances",
    headOnly: true,
    cta: { label: "Open Finances", tab: "finances" },
  },

  // ---------------------------------------------------------- parent-portals
  {
    id: "availability-portal",
    category: "parent-portals",
    title: "The availability portal",
    summary:
      "Parents submit the dates their kid can't make; you merge them onto the roster.",
    keywords: "availability parent portal absence submit vacation dates merge",
    sections: [
      {
        body: "Share the availability link and parents mark the dates their kid is out — no account needed. Submissions that clearly match a roster player merge onto that player's absences; ambiguous ones wait in a match queue for you to resolve.",
      },
      {
        body: "Once merged, the lineup generator benches the player for those dates automatically.",
      },
    ],
    related: ["absences-departed", "share-links-qr"],
    featureId: "availability",
    headOnly: true,
    cta: { label: "Open Availability", tab: "availability" },
  },
  {
    id: "player-info-portal",
    category: "parent-portals",
    title: "The player info portal",
    summary:
      "A parent-submitted inbox for sizing and logistics — jersey sizes without the group text.",
    keywords: "player info sizing jersey size contact logistics parent form",
    sections: [
      {
        body: "Share the player info link and parents submit sizing and logistics details themselves. Submissions collect in the Player Info inbox for you to review and apply — one link instead of chasing twelve families for jersey sizes.",
      },
    ],
    related: ["share-links-qr"],
    featureId: "playerInfo",
    headOnly: true,
    cta: { label: "Open Player Info", tab: "playerInfo" },
  },
  {
    id: "share-links-qr",
    category: "parent-portals",
    title: "How share links and QR codes work",
    summary:
      "Public portal links parents can open without an account, each with a downloadable QR code.",
    keywords: "share link qr code public url flyer anonymous parents access",
    sections: [
      {
        body: "Tryout signup, player interest, availability, and player info all use the same pattern: a public link tied to your team that parents open without creating an account. Each link has a downloadable QR code sized for flyers and team banners.",
      },
      {
        body: "Parents can only submit through the form — they never see your roster, stats, or anything else. Turning a feature's tab off in Settings does not kill its link; intake has its own controls (like the tryouts-open switch).",
      },
    ],
    related: ["tryout-setup", "availability-portal", "feature-toggles"],
  },

  // ------------------------------------------------------------ settings-team
  {
    id: "team-identity-rules",
    category: "settings-team",
    title: "Team identity, league rules, and pitching format",
    summary:
      "Name, age group, colors, logo, and the rule set that drives the engine.",
    keywords:
      "team name age group colors logo brand league rules pitching format nkb usssa",
    sections: [
      {
        heading: "Identity",
        body: "Settings holds the team name, age group, and colors — the whole app re-themes to your colors, and the logo you upload is auto-compressed so it never bloats the team data.",
      },
      {
        heading: "League rules & pitching format",
        body: "Pick your league rule set and pitching format here. These drive pitch-eligibility math, the catcher cap, and lineup recommendations — get them right before you generate lineups, not after.",
      },
    ],
    related: ["lineup-generator", "feature-toggles"],
    headOnly: true,
    cta: { label: "Open Settings", tab: "settings" },
  },
  {
    id: "feature-toggles",
    category: "settings-team",
    title: "Feature toggles",
    summary:
      "Hide the modules your team doesn't use — a rec team without tryouts shouldn't carry the tab.",
    keywords: "toggle feature hide tab disable module enable switch off",
    sections: [
      {
        body: "Settings lets you switch off optional modules: Practices, Stats, Depth Chart, Tryouts, Player Interest, Player Info, Availability, and Finances. A toggle hides the tab and its routes for every coach; the core surfaces (Home, Roster, Schedule, Evaluation, Settings) can never be turned off.",
      },
      {
        body: "Public portal links keep working when a feature is hidden — closing intake is a separate control. Flip a feature back on anytime; nothing is deleted.",
      },
    ],
    related: ["share-links-qr", "team-identity-rules"],
    headOnly: true,
    cta: { label: "Open Settings", tab: "settings" },
  },
  {
    id: "invite-coaches",
    category: "settings-team",
    title: "Inviting coaches",
    summary:
      "Share the 6-character join code; assistants get everything except money, portals, and settings.",
    keywords:
      "invite assistant coach join code staff add coach roles permission",
    sections: [
      {
        body: "Share your team's 6-character join code and any coach who enters it joins as an assistant. The code is durable — one code works for your whole staff.",
      },
      {
        heading: "What assistants can do",
        body: "Assistants see the roster, schedule, lineups, stats, and tryouts, and submit their own evaluation rounds. Settings, Finances, and the parent-portal inboxes stay head-coach-only.",
      },
    ],
    related: ["assistant-evals", "create-or-join-team"],
    headOnly: true,
    cta: { label: "Open Settings", tab: "settings" },
  },
  {
    id: "season-rollover",
    category: "settings-team",
    title: "Advance Season",
    summary:
      "Archive the season per player, promote accepted tryout kids, and start clean.",
    keywords:
      "advance season rollover archive next year new season returning released",
    sections: [
      {
        body: "Advance Season is a two-step wizard: mark every player Returning or Released in one pass (accepted tryout players are locked in already), review the summary, and confirm.",
      },
      {
        heading: "What gets archived",
        body: "Each player's season stats plus a compact development summary — games played, attendance rate, evaluation start/end scores, and innings by position — are archived to their past-seasons history. That history powers year-over-year development views and multi-season stat blending.",
      },
      {
        heading: "What gets cleared",
        body: "Games, current-season stats, and evaluation rounds reset for the new season. Released players leave the active roster; accepted tryout signups you promote come onto it. Archiving also frees storage space in the team document.",
      },
    ],
    related: ["tryout-grading", "development-view"],
    headOnly: true,
    cta: { label: "Open Settings", tab: "settings" },
  },

  // -------------------------------------------------------------- shortcuts
  {
    id: "keyboard-shortcuts",
    category: "shortcuts",
    title: "Keyboard shortcuts",
    summary: "Every key the app listens for, and when they're active.",
    keywords: "keyboard shortcut hotkey keys cmd ctrl k g b escape numbers",
    sections: [
      {
        body: "Shortcuts work anywhere in the app once you're signed in. Everything except the command palette is ignored while you're typing in a form field.",
        list: [
          "Cmd+K / Ctrl+K — open the command palette (works even inside form fields)",
          "1–5 — jump to the first five tabs, in your tab bar's order",
          "? — open this Help Center",
          "G — regenerate the lineup (when a game is open for editing)",
          "B — regenerate the batting order (same rule as G)",
          "Esc — close the open dialog or overlay",
        ],
      },
    ],
    related: ["command-palette-help", "lineup-locks-editing"],
  },

  // --------------------------------------------------------------- glossary
  {
    id: "glossary-terms",
    category: "glossary",
    title: "Glossary",
    summary: "The stats and app terms used across the tables and reports.",
    keywords:
      "glossary define definition avg obp ops qab babip whip battery bench equity run differential pool bracket pitch eligibility big game",
    sections: [
      {
        heading: "Batting",
        body: "The core hitting numbers on the stat tables:",
        list: [
          "AVG — batting average: hits divided by at-bats.",
          "OBP — on-base percentage: how often a plate appearance ends on base (hits, walks, hit-by-pitch).",
          "OPS — OBP plus slugging; the best single number for overall offense.",
          "QAB — quality at-bats: productive plate appearances (hard contact, moving runners, long counts), as scored in GameChanger.",
          "BABIP — batting average on balls in play; extreme values usually mean luck, not skill, at this level.",
        ],
      },
      {
        heading: "Pitching & defense",
        body: "Terms from the mound and behind the plate:",
        list: [
          "WHIP — walks plus hits per inning pitched; lower is better.",
          "Pitch eligibility — the rest rules from your league's pitching format that decide who's allowed to pitch today.",
          "Battery — the pitcher and catcher, as a unit.",
        ],
      },
      {
        heading: "The Bench Coach terms",
        body: "Words this app uses with a specific meaning:",
        list: [
          "Bench equity — how evenly bench time is spread; measured as extra sits beyond each game's fair minimum.",
          "Run differential — runs scored minus runs allowed; the trend line of team strength.",
          "Big Game — a starred game where the generator fields primary/secondary positions only instead of rotating.",
          "Pool / bracket play — tournament phases; bracket games are elimination games and get deeper pitching plans.",
        ],
      },
    ],
    related: ["stat-tables", "lineup-generator"],
  },
];

const TOPICS_BY_ID = new Map(HELP_TOPICS.map((t) => [t.id, t]));

export const getHelpTopic = (id: string): HelpTopic | undefined =>
  TOPICS_BY_ID.get(id);

// The topics a given viewer should see: assistants lose headOnly topics,
// and a feature toggled off in Settings takes its articles with it.
export const visibleHelpTopics = (
  team: { disabledFeatures?: string[] } | null | undefined,
  role: string | null | undefined,
): HelpTopic[] =>
  HELP_TOPICS.filter(
    (t) =>
      !(t.headOnly && role === "assistant") &&
      (!t.featureId || featureEnabled(team, t.featureId)),
  );

// Contextual help: which category the Help Center opens to for each tab.
export const TAB_TO_HELP_CATEGORY: Record<string, HelpCategoryId> = {
  home: "getting-started",
  schedule: "schedule-games",
  practices: "practices",
  roster: "roster",
  stats: "stats-analytics",
  depthChart: "evaluations",
  evaluation: "evaluations",
  tryouts: "tryouts-recruiting",
  interest: "tryouts-recruiting",
  playerInfo: "parent-portals",
  availability: "parent-portals",
  finances: "finances",
  settings: "settings-team",
};

// Where the match landed decides its weight: a title hit beats a keyword hit
// beats a body hit. Offsets are larger than any realistic substring index but
// smaller than fuzzyScore's +1000 loose-match penalty, so a loose title match
// still ranks below an exact body match.
const KEYWORD_OFFSET = 50;
const BODY_OFFSET = 200;
const MAX_RESULTS = 12;

// Rank `topics` against `query`. A topic's score is the best (lowest) of its
// title / keyword / body component scores; a component that misses (-1) just
// doesn't contribute, and the topic is dropped only when all three miss.
// An empty or whitespace-only query returns the input list unchanged — the
// caller shows the browse view.
export const searchHelpTopics = (
  topics: HelpTopic[],
  query: string,
): HelpTopic[] => {
  const q = query.trim();
  if (!q) return topics;

  const scored: Array<{ topic: HelpTopic; score: number; index: number }> = [];
  topics.forEach((topic, index) => {
    const components: number[] = [];
    const title = fuzzyScore(topic.title, q);
    if (title !== -1) components.push(title);
    const keywords = fuzzyScore(topic.keywords, q);
    if (keywords !== -1) components.push(keywords + KEYWORD_OFFSET);
    const body = fuzzyScore(
      topic.summary + " " + topic.sections.map((s) => s.body).join(" "),
      q,
    );
    if (body !== -1) components.push(body + BODY_OFFSET);
    if (components.length === 0) return;
    scored.push({ topic, score: Math.min(...components), index });
  });

  scored.sort((a, b) => a.score - b.score || a.index - b.index);
  return scored.slice(0, MAX_RESULTS).map((s) => s.topic);
};
