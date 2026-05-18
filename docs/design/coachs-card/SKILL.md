---
name: Coach's Card Design System
description: Visual system for Coach's Card — a youth-baseball coach's web app (rosters, lineups, in-game tools, stats). Use when designing, prototyping, or shipping any UI for this product.
---

# Coach's Card Design System

Coach's Card is a single responsive web app for youth-baseball coaches —
rosters, lineup generation, in-game console, season stats. No marketing
site, no admin surface, no dark mode. Visual character: utilitarian
coach's-tool, **not** sports-marketing hero. Black-weight uppercase
type, slate neutrals, a single user-tunable team color, glass cards on
a slate-50 background.

## When to use

- Designing or prototyping any Coach's Card screen.
- Adding a new screen, component, or pattern to the production
  codebase (github.com/michaelrash3/lineuptool).
- Answering "what color / radius / weight / shadow should this be?"
- Producing handoff packages, marketing crops, or PPTX decks that
  must look on-brand.

## How to use

1. **Read [`README.md`](README.md) first.** It contains the full
   narrative — content fundamentals (voice, copywriting, vocabulary)
   and visual foundations (the rationale behind every token).
2. **Pull tokens from [`colors_and_type.css`](colors_and_type.css).**
   Every color, font stack, radius, shadow, and spacing value is a
   CSS custom property on `:root`. Import the file, reference
   `var(--token-name)`. Do not invent new tokens.
3. **Browse [`preview/`](preview/) for the canonical look of any
   piece.** 20 cards, one per pattern, each rendered at 700px wide.
   These are the source of truth — when in doubt, open the relevant
   card and read its CSS.
4. **Use [`ui_kits/coachs-card-app/`](ui_kits/coachs-card-app/) for
   working React/JSX.** Mock data, chrome, dashboard components,
   index page wired up via CDN React + Tailwind. Match this when
   building inside the production codebase.
5. **Icon rules live in [`ICONOGRAPHY.md`](ICONOGRAPHY.md).** Five
   custom baseball SVGs in `assets/iconography/` + the sanctioned
   Lucide subset + the emoji vocabulary (⭐ for Big Game — never ⚡).

## Non-negotiables

- **Type:** Inter for everything sans, JetBrains Mono for stat
  numerals. Headings are **`font-weight: 900` + uppercase + wide
  tracking** — this is the brand voice. Do not use medium weight for
  headings.
- **Color:** The team triplet (`--team-primary`, `--team-secondary`,
  `--team-tertiary`) is **user-tunable** per team — defaults to
  `#2563eb / #f8fafc / #ffffff` but the coach picks. Reference the
  CSS variables; never hardcode `#2563eb`. Slate scale handles
  everything else. Semantic lanes (success / danger / warning /
  info) only for status — not for decoration.
- **Surface:** Glass card recipe is canonical — `bg-white/30` or
  `/40` on a `slate-50` body, 1px `rgba(255,255,255,0.5)` hairline,
  `0 4 20 / 4%` shadow, 16px radius. **No dark mode.** No glass on
  dark.
- **Radius:** Nest inward. `2xl` (16px) card → `xl` (12px) button →
  `lg` (8px) inner chip. Never repeat the same radius across two
  stacked layers.
- **Emoji:** Only the sanctioned set (⭐ 🔥 🏆 ✅ ⚾ 📋). ⚡ and 🎯 are
  retired. Most surfaces use **zero** emoji.
- **No AI slop:** No gradient hero backgrounds, no rounded-corners-
  with-left-border-accent containers, no decorative icon halos
  outside the established leaderboard pattern, no SVG-drawn
  imagery — use placeholders or real photos.

## Output guidance for designs in this system

- Slate-50 backdrop on every screen.
- Always start with chrome — accent strip + glass header + dark
  utility band + tab pills — even on a single-screen mock.
- For "more pizazz" requests: reach for **more team-primary
  gradient** (on jersey plates, primary CTAs, value pills),
  **tabular-numeral pills** for any stat, and **accent strips** at
  the top of card-like surfaces — not decorative gradients,
  illustrations, or busy backgrounds.
- The production app is a coach's working tool. Restraint reads as
  competence here.

## Files at a glance

```
README.md                  ← read first — full system narrative
colors_and_type.css        ← every token as a CSS custom property
ICONOGRAPHY.md             ← icon + emoji rules
assets/
  baseball-mark.svg        ← logo
  iconography/             ← 5 custom baseball SVGs
preview/
  _card.css                ← shared shell for cards
  01-team-triplet.html     ← user-tunable team color recipe
  02-slate-scale.html      ← slate 50-900
  03-semantic-lanes.html   ← success / danger / warning / info
  04-type-display.html     ← display / h1 / h2 / h3 / card title
  05-type-body.html        ← eyebrow / label / button / body / meta / stat numeral
  06-iconography.html      ← baseball + Lucide + emoji vocabulary
  07-buttons.html          ← primary / secondary / ghost / semantic
  08-form-inputs.html      ← light selects + dark-band inline input
  09-badges-chips.html     ← status / result / stat / meta
  10-card-anatomy.html     ← glass card recipe
  11-radii.html            ← radius scale + nesting rule
  12-shadows.html          ← shadow ramp
  13-spacing.html          ← 4-pt spacing scale
  14-tab-bar.html          ← header chrome + tab pills
  15-roster-row.html       ← player list row
  16-modal.html            ← confirmation dialog
  17-toasts.html           ← notification stack
  18-leaderboard-card.html ← stat top-3 card
  19-upcoming-game.html    ← hero game card
  20-stat-blocks.html      ← big-number tiles + record bar
ui_kits/coachs-card-app/   ← working React/JSX UI kit
  README.md                ← how to assemble screens from primitives
  index.html               ← click-through prototype (Login → Dashboard)
  Chrome.jsx               ← LoginScreen, AppHeader, TabBarNav
  HomeDashboard.jsx        ← UpcomingGameCard, TeamSummary, LeaderboardCard
  mock-data.js             ← sample team, players, games, coaches
```
