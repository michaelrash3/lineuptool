# Handoff: Coach's Card Design System

## Overview

This bundle is a **design-system + UI-kit handoff** for **Coach's Card**
(the rebranded production app at github.com/michaelrash3/lineuptool — a
React/TypeScript web app for youth-baseball coaches to manage rosters,
generate lineups, and track stats).

It contains:

- A full design-system reference (`SOURCE_README.md`) — content
  fundamentals, visual foundations, and the rationale behind every
  decision.
- A token file (`colors_and_type.css`) — every color, font, radius,
  shadow, spacing value as CSS custom properties on `:root`.
- An iconography reference (`ICONOGRAPHY.md` + `assets/iconography/`) —
  five custom baseball-themed SVGs plus the sanctioned Lucide subset
  and emoji vocabulary.
- 20 preview cards (`preview/`) — each isolated piece of the system
  rendered at 700px wide. Every card pulls from `colors_and_type.css`
  via `_card.css`. **These are the source of truth for visual
  fidelity** — when a developer asks "what does our roster row look
  like," the answer is `preview/15-roster-row.html`.
- A working-prototype UI kit (`ui_kits/coachs-card-app/`) — React/JSX
  components that recreate Login, Dashboard, etc. via CDN React +
  Tailwind. These mirror the imported `src/` structure of the
  production repo.

## About the design files

**The files in this bundle are design references created in HTML.** They
are prototypes showing intended look, layout, and behavior — they are
**not production code to copy and paste.**

The Coach's Card production codebase is a React 18 / TypeScript SPA
built on Tailwind utility classes and CRA. The task is to **recreate
these HTML designs inside that existing codebase**, using its
established components (`src/components/`), screens
(`src/screens/`), icons (`src/icons.tsx`), context
(`src/contexts.js`), and Tailwind patterns — not to lift the HTML
verbatim. The HTML cards exist to communicate intent at the
pixel/token level.

## Fidelity

**High-fidelity (hifi).** Final colors, type, spacing, radii, shadows,
and component anatomy. All tokens are in `colors_and_type.css` and are
the values the developer should match.

The five `preview/*` cards under group "Components" that show full
patterns (roster row, upcoming game, modal, toasts, tab bar,
leaderboard, stat blocks) are pixel-faithful — but should be rebuilt
using the production codebase's existing primitives, not by porting the
HTML.

## Design tokens

Every value is defined in `colors_and_type.css`:

| Group | Examples |
|---|---|
| **Team triplet** | `--team-primary` (user-tunable, default `#2563eb`), `--team-secondary` (`#f8fafc`), `--team-tertiary` (`#ffffff`) — drives every accent. The user can change this per-team via Settings. |
| **Slate scale** | `--slate-50` → `--slate-900` (Tailwind slate). 95% of the UI lives here. |
| **Semantic lanes** | Success (`emerald`), Danger (`rose`), Warning (`amber`), Info (`indigo`) — each at 50/200/600/700 stops. |
| **Type scale** | `--font-sans` (Inter), `--font-mono` (JetBrains). `--text-2xs`–`--text-6xl`. Weights 500 → 900. **Heavy use of `900` (black) + uppercase + wide tracking** is the brand voice. |
| **Radii** | `--radius-sm` 4 · `md` 6 · `lg` 8 · `xl` 12 (default) · `2xl` 16 (cards) · `full` 9999. |
| **Shadows** | `--shadow-card` (`0 4 20 / 4%`), `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-inner`. |
| **Spacing** | 4-pt base. `--space-1` (4px) → `--space-12` (48px). |
| **Glass surface** | `--surface-glass-3` = `rgba(255,255,255,0.3)` over `--bg-app` (`slate-50`) is the canonical card background. Pair with `--hairline` (`rgba(255,255,255,0.5)`) and `--shadow-card`. |

## Screens / Views

There is **one product surface** — a single responsive web app. The
production code splits it into five screens, but for handoff purposes
they share one chrome:

### Chrome (`ui_kits/coachs-card-app/Chrome.jsx` + `preview/14-tab-bar.html`)

- **AppHeader** — translucent white slab with 6px team-primary
  accent strip at top edge. Logo (64×64) + team name (`text-2xl
  font-black uppercase tracking-tight`) + record pill (team-primary
  bg, `.412`-style tabular numerals) + season/team selectors.
- **Dark utility band** — `bg-slate-900/85`, 14px high, contains New
  Team / Join Team buttons and the cloud-sync indicator.
- **Tab bar** — translucent slab, `rounded-full` pills, active state
  uses `--team-secondary` bg + `--team-primary` text + 1px
  `--team-primary` border. Settings tab is right-pushed
  (`ml-auto`).

### Login (`ui_kits/coachs-card-app/Chrome.jsx` → `LoginScreen`)

- Full-screen `bg-slate-50`, 8px top border in `--team-primary`.
- Centered glass card (`bg-white/40`, `rounded-2xl`,
  `shadow-2xl`, max-w 360px). Logo halo, "LINEUP GENERATOR" h1, "Sign
  In with Google" primary CTA.

### Home Dashboard (`HomeDashboard.jsx`)

Three stacked sections, 32px gaps:

1. **UpcomingGameCard** (`preview/19-upcoming-game.html`) — glass
   card with 6px primary strip, calendar icon halo,
   "Today"+"Lineup Ready" chips, "VS. {opponent}" title, dual CTA
   (In-Game green / Edit Lineup primary).
2. **TeamSummary** — large h2 team name, metadata chip row, record
   pill, head-coach / assistant-coach block, two big-number stat
   tiles (Roster Size / Games).
3. **Hitting + Fielding Leaders** (`preview/18-leaderboard-card.html`)
   — 4-column grid of LeaderboardCard. Each card: icon halo +
   title in header, top-3 players in body with rank `1.`/`2.`/`3.`,
   player name, value pill in team-primary.

### Roster (`preview/15-roster-row.html`)

Grid of player rows. Each row anatomy:

- **Jersey plate** — 52×52, gradient `#2563eb → #1d4ed8`, 12px
  radius, white tabular numeral jersey number with
  `font-weight: 900`.
- **Identity block** — Name (uppercase black 16px, `tracking-tight`)
  + presence dot (emerald-500 with 3px ring when present; slate-400
  when absent). Tag row: position (blue bg), B/T, age/status.
- **Stats strip** — 4 cells horizontally banded inside one
  `rounded-lg` container. Leading stat (`AVG`) gets a blue tint
  (`bg-blue-50`, `text-blue-700`).
- **Trailing kebab menu** — 32×32 transparent button.

### Modal (`preview/16-modal.html`)

Full-viewport `bg-slate-900/60` scrim → white modal card with 6px
primary strip → padded body (24px) → title h3, body text, two
buttons right-aligned (Cancel ghost, Confirm primary).

### Toasts (`preview/17-toasts.html`)

Top-right stack, 10px gap. Four kinds — solid backgrounds:
slate-900 (default), emerald-600 (success), rose-600 (danger),
amber-500 (warning). Each: 12px padding, 12px radius, title in
`font-black uppercase tracking-wider 13px` over message in 11px
700.

### Component primitives

| Card | Use for | Token-faithful preview |
|---|---|---|
| 01 team-triplet | The 3 user-tunable team colors | `preview/01-team-triplet.html` |
| 02 slate-scale | Neutral palette stops | `preview/02-slate-scale.html` |
| 03 semantic-lanes | Success / Danger / Warning / Info | `preview/03-semantic-lanes.html` |
| 04 type-display | Display, h1, h2, h3, card title | `preview/04-type-display.html` |
| 05 type-body | Eyebrow, label, body, button, meta, stat numeral | `preview/05-type-body.html` |
| 06 iconography | 5 baseball SVGs + Lucide subset + emoji vocabulary | `preview/06-iconography.html` |
| 07 buttons | Primary / Secondary / Ghost / Semantic | `preview/07-buttons.html` |
| 08 form-inputs | Light selects + dark-band inline input | `preview/08-form-inputs.html` |
| 09 badges-chips | Status / Result / Stat / Meta chips | `preview/09-badges-chips.html` |
| 10 card-anatomy | Glass surface + accent strip recipe | `preview/10-card-anatomy.html` |
| 11 radii | Radius scale | `preview/11-radii.html` |
| 12 shadows | Shadow ramp | `preview/12-shadows.html` |
| 13 spacing | 4-pt spacing scale | `preview/13-spacing.html` |
| 14 tab-bar | Header chrome + tab pills | `preview/14-tab-bar.html` |
| 15 roster-row | Player list row | `preview/15-roster-row.html` |
| 16 modal | Confirmation dialog | `preview/16-modal.html` |
| 17 toasts | Notification stack | `preview/17-toasts.html` |
| 18 leaderboard-card | Stat top-3 card | `preview/18-leaderboard-card.html` |
| 19 upcoming-game | Hero game card | `preview/19-upcoming-game.html` |
| 20 stat-blocks | Big-number tiles + record bar | `preview/20-stat-blocks.html` |

## Interactions & Behavior

The existing production codebase already implements interaction logic —
this handoff is **visual / token / anatomy only**. Notable visual-only
behaviors:

- **Glass cards** (`bg-white/30` or `/40`) sit over a `slate-50`
  body. Do not put glass on a dark background — the system has no
  dark mode.
- **Hover lift** on leaderboard cards: `hover:-translate-y-1
  transition-transform duration-300`.
- **Primary CTA hover**: `hover:-translate-y-0.5 hover:shadow-xl`.
- **Tab pills**: active = secondary bg + primary text + primary
  border; inactive = transparent → hover: `bg-white/80
  text-slate-900`.
- **`⭐ Big Game` flag**: prepend `⭐` (gold star) to game titles
  flagged as big games. **Do not** use ⚡ (lightning bolt) — it was
  retired as too generic.
- **Presence dot**: emerald-500 with a 3px emerald-500/18 ring when
  player is `present`; slate-400 ring when absent. Add `opacity:
  0.72` to the whole row when absent.

## State Management

N/A for handoff. The production codebase has its own contexts
(`src/contexts.js` — `useTeam`, `useUI`) — keep them.

## Assets

| Asset | Location | Source |
|---|---|---|
| Baseball mark (logo placeholder) | `assets/baseball-mark.svg` | Custom SVG |
| Custom baseball icons (5) | `assets/iconography/*.svg` | Custom SVG, 24×24, 1.6px stroke, `currentColor` |
| Lucide icons | imported via `import { ... } from "lucide-react"` | Existing in `src/icons.tsx` |
| Fonts | Inter (sans), JetBrains Mono (mono) | Google Fonts CDN |
| Emoji vocabulary | sanctioned: ⭐ 🔥 🏆 ✅ ⚾ 📋 — retired: ⚡ 🎯 | system emoji |

## Files

```
SOURCE_README.md           ← the full design-system narrative (read first)
ICONOGRAPHY.md             ← icon usage rules
colors_and_type.css        ← every token as a CSS custom property
preview/                   ← 20 isolated component cards, 700px wide
preview/_card.css          ← shared shell for cards (imports colors_and_type.css)
assets/baseball-mark.svg   ← logo
assets/iconography/        ← 5 custom baseball SVGs (home-plate, jersey, bat, glove, pitch)
ui_kits/coachs-card-app/   ← React/JSX prototype components matching production src/ structure
  README.md                ← how to assemble screens from these primitives
  Chrome.jsx               ← LoginScreen, AppHeader, TabBarNav
  HomeDashboard.jsx        ← UpcomingGameCard, TeamSummary, LeaderboardCard
  mock-data.js             ← sample team, players, games, coaches
```

## Implementation order (suggested)

1. **Wire tokens.** Port `colors_and_type.css` into the production
   Tailwind config (extend `theme.colors`, `theme.fontFamily`,
   `theme.boxShadow`, `theme.borderRadius`). Most values already
   match Tailwind defaults — slate / emerald / rose / amber / indigo
   are stock.
2. **Update `src/icons.tsx`** to add the 5 baseball SVGs as React
   components — match the existing pattern of wrapping Lucide
   imports.
3. **Refresh Chrome** (`src/components/Chrome.jsx`) to match the
   accent-strip + glass + dark utility band recipe.
4. **Refresh screen components** (`src/screens/HomeTab.jsx`,
   `RosterTab.jsx`, `SettingsTab.jsx`, etc.) using the cards in
   `preview/` as visual specs.
5. **Audit emoji usage** — replace any `⚡` with `⭐` for Big Game.

## Outstanding from this design session

- The Iconography card (`preview/06-iconography.html`) had several
  rounds of feedback. The custom baseball SVGs in `assets/iconography/`
  are the current committed state; if they still don't read as
  baseball gear, the recommended escape hatch is to **use emoji
  (⚾ 🥎 🧤 🧢) in place of the custom SVGs** in marketing surfaces and
  keep Lucide's generic icons (Users, Calendar, Clipboard) for app
  chrome.
- Several component cards (Upcoming Game, Buttons, Tab Bar, Roster
  Row, Modal, Stat Blocks, Toasts, Leaderboard) had a "bland" note.
  The committed versions are intentionally restrained because the
  production app is a coach's working tool, not a marketing surface.
  If more pizazz is desired in shipping code, the path is more
  accent-strip use, more tabular-numeral pills, more team-primary
  gradient (e.g. on the jersey plate, already shipped) — **not**
  decorative gradients or hero illustrations.
