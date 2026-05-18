# Coach's Card — Design System

A design system for **Coach's Card** (working title), a youth-baseball lineup
generator and team-management web app built by Michael Rash. The app helps a
head coach manage a roster, run player evaluations, schedule games, generate
optimised batting/defensive lineups, and run an in-game console that tracks
position rotations and pitch counts inning by inning.

This folder contains every token, asset, and component spec needed to design
new screens, slides, or marketing surfaces that look like first-party Coach's
Card.

---

## Source materials

| Source | Notes |
| --- | --- |
| **GitHub** | [`michaelrash3/lineuptool`](https://github.com/michaelrash3/lineuptool) — the production React/TypeScript codebase (CRA + Tailwind via CDN + Firebase). The whole system below was reverse-engineered from this repo. |
| **App title** | The `<title>` in `public/index.html` is **"Coach's Card"**, but the login screen reads **"Lineup Generator"**. We've chosen *Coach's Card* as the canonical brand name; the underlying GitHub repo is `lineuptool`. |
| **No Figma** | None provided. Visual specs were extracted directly from JSX + Tailwind class strings. |
| **No deck templates** | None provided. |

---

## Index — what lives where

```
README.md                  ← you are here
SKILL.md                   ← Agent Skill front-matter (Claude Code compatible)
colors_and_type.css        ← CSS vars: colors, type, spacing, radii, shadows
assets/                    ← logo / favicon / placeholder photography
fonts/                     ← (none shipped; Inter is loaded from Google Fonts)
preview/                   ← Design System review cards (registered as assets)
ui_kits/
  coachs-card-app/         ← The web app UI kit (Dashboard, Roster, In-Game…)
src/                       ← Untouched import of the source repo, for reference
```

---

## The product in one screen

Coach's Card is **one product, one platform** — a responsive React web app a
volunteer coach uses on a phone in the dugout and a laptop at home. There is
no marketing site, native app, or admin surface. The whole UI lives behind a
Google sign-in.

**Five top-level tabs** drive the entire experience:

1. **Home** — record badge, next game card, hitting/fielding/pitching leaders.
2. **Roster** — jersey-numbered list of every player with their season splits.
3. **Schedule** — games, lineup editor, score reporting, post-game stats.
4. **Evaluation** — six-axis (Fielding, Baseball IQ, Arm, Speed, etc.) scoring
   tool that feeds the lineup engine and roster-decision panel.
5. **Settings** — team triplet color picker, logo upload, CSV import, season
   advance, coach management.

Plus a sixth modal-route, **In-Game**, that takes over the screen on game day:
inning-by-inning position assignments, pitch-count enforcement, undo stack.

---

## Content fundamentals

The voice is **a coach's clipboard, not an enterprise dashboard.** It's direct,
boxy, and very confident about jargon. The system trusts the user knows what
RBI, OPS, and "Kid Pitch" mean. Marketing-style hedging is absent.

### Tone

- **Imperative & terse.** Buttons read `Add Player`, `Plan Lineup`, `Final
  Score`, `Edit Lineup`. Verbs first, no preamble.
- **Authoritative coach voice.** Labels like `Head Coach Dashboard`,
  `Authentication Required`, `In-Game` — sounds like a binder tab, not a
  helper bot.
- **Domain-fluent.** The app freely uses `OBP`, `OPS`, `RBI`, `Putouts`,
  `Assists`, `Total Chances`, `BB/T`, and league shorthand (`USSSA`, `NKB`,
  `Kid Pitch`, `8U`). It never explains them.
- **Empty states are blunt, not cute.** When a leaderboard has no data it
  reads `DATA VOID`. The empty roster says `NO ROSTER FOUND` and gives two
  next steps. No mascots, no "Oh no!".

### Person

- **"You" sparingly.** Most copy is impersonal labels (`Roster Size`, `Games`,
  `Record`). When the system does address the user it does so as a peer:
  `Manually add players to build your team, or head to Settings to import
  your stats file.`
- **Never first-person.** No "I'll", no "Let me".

### Casing

This is the strongest stylistic rule in the system:

- **UPPERCASE EVERYWHERE.** Buttons, tabs, labels, badges, eyebrows, card
  titles — almost every piece of chrome is uppercase. Wide letter-spacing
  (`tracking-widest`) reinforces it.
- **Body copy is Sentence case.** The two-line paragraphs that appear in
  empty states and tooltips drop the caps.
- **Numbers are tabular-nums** so scores and stats line up in columns.

### Emoji & glyphs

- **One emoji, on purpose:** `⚡` decorates the "Big Game" flag on the
  upcoming-game card. That's it. No others appear anywhere in the codebase.
- **No unicode symbols** standing in for icons — pipes are rendered as a
  faded `|` between meta items, and only there.
- **Bat / Glove / Pitch / Jersey / HomePlate** are hand-drawn baseball
  glyphs (see `assets/iconography/`), not emoji.

### Examples (lifted verbatim)

| Surface | Copy |
| --- | --- |
| Login title | `LINEUP GENERATOR` |
| Login sub | `AUTHENTICATION REQUIRED` |
| Header eyebrow | `HEAD COACH DASHBOARD` |
| Next-game chip | `TODAY` · `TOMORROW` · `LINEUP READY` · `LINEUP NEEDED` |
| Empty-stats state | `DATA VOID` |
| Roster empty | `NO ROSTER FOUND` |
| Player on absent | `OUT` |
| Sync indicator | `Saving` · `Saved` · `Creating` |
| Confirm modal default | `Confirm` / `Cancel` |
| Toast errors | `Could not import` · `Could not read file` |

---

## Visual foundations

The system reads as **"frosted clipboard"**: a warm-grey wash backdrop, white
glass cards floating on top, one bold team color cutting through as accent
bars and primary buttons. Nothing is fully opaque except text and the
primary-color CTAs.

### Color

- **Team triplet drives all chroma.** Every team has a `primaryColor`
  (default `#2563eb`), `secondaryColor` (default `#f8fafc`), and
  `tertiaryColor` (default `#ffffff`). Buttons, header stripe, accent bars,
  badge fills, and active-tab chrome all read from these three vars. The
  rest of the canvas is monochrome slate.
- **Neutrals = Tailwind slate** (50–900). 95% of the UI is built from this
  one scale plus white.
- **Semantic lanes** are restrained: green for wins / `Saved`, red for
  losses / errors, amber for warnings (`LINEUP NEEDED`), blue for info.
  Each lane uses `-50` (chip fill) + `-200` (chip border) + `-700` (chip
  text).
- **No gradients.** The system avoids the bluish-purple SaaS gradient look
  entirely. Color volume comes from the team-tinted primary, not from
  gradients.
- **No dark mode** in the codebase. Everything is light.

### Type

- **Single family**, weights 400/500/600/700/800/**900**. The 900 ("black")
  weight is the workhorse for buttons, headings, and badges. 500–700 are
  body. 400 is barely used.
- The codebase ships **no webfont** — it relies on Tailwind's default
  `font-sans` system stack. We substitute **Inter** from Google Fonts as the
  closest free analogue with a true 900 weight. **⚠ Flagged for confirmation
  — see "Substitutions" below.**
- **All chrome is UPPERCASE with wide tracking** (`tracking-widest` = 0.1em).
- **Numerals use `tabular-nums`** so columns of stats align.

### Spacing & layout

- **4px base** (Tailwind default). The two most common gaps are `gap-3`
  (12px) and `gap-4` / `gap-5` / `gap-6` (16/20/24px).
- **Page container caps at `max-w-7xl`** (1280px) and is centered with
  generous horizontal padding (`px-4 sm:px-6 lg:px-8`).
- **Cards breathe.** Standard card padding is 20–32px (`p-5` to `p-8`); the
  major dashboard sections use `p-6 sm:p-8`.
- **Mobile-first.** Every list flips column → row at the `sm:` breakpoint;
  the header restacks at `md:`.

### Backgrounds

- **App background:** `bg-slate-50` — never pure white. This makes the
  white-glass cards read as floating.
- **No imagery** in the chrome. The login screen optionally lays the team
  logo behind the auth card at 25% opacity, 60% size, centered — that's the
  only image-as-background pattern.
- **No repeating patterns, no textures, no hand-drawn illustrations.**

### Cards

- **Glass surface:** `bg-white/30` or `bg-white/40` with `border
  border-white/50` and `shadow-[0_4px_20px_rgb(0,0,0,0.04)]`. Always
  `rounded-2xl` (16px) for the outer wrapper, `rounded-xl` (12px) for nested
  controls.
- **Accent strip:** Many cards open with a 6px `h-1.5` strip of the team
  primary color across the top — a recurring "primary on top of glass"
  signature.
- **Section headers inside cards** sit on a slightly less transparent
  `bg-white/20` or `bg-white/40` band with a `border-b border-white/40`.

### Corners

- `rounded-xl` (12px) is the default for buttons, inputs, chips.
- `rounded-2xl` (16px) for cards and panels.
- `rounded-full` for player number badges, icon halos, tab pills, and the
  upper-right "code copied" / "team code" CTA.

### Borders

- **Glass borders** are `border-white/50` — visible only because of the
  white-tinted glass behind them.
- **Solid borders** are `border-slate-200` for any opaque surface.
- **Hairline dividers** inside dense cards (between leaderboard items) use
  `border-white/40`.
- **No "colored left-border accent" pattern.** The roster row is the *only*
  place a left border appears, and it's there to mark the team color
  attached to each player card — a deliberate, single use.

### Shadows

- **Card shadow** is intentionally **subtle**: `0 4px 20px rgb(0 0 0 / 0.04)`.
  The system depends on it being almost imperceptible; cards float on
  contrast against `slate-50`, not on a dark drop.
- **Buttons get a slightly stronger shadow** — `shadow-md` resting,
  `shadow-lg` on the primary CTA. They lift on hover (`-translate-y-0.5`).
- **Inner shadows** (`shadow-inner`) appear inside text inputs in the dark
  band of the header, and on the squad icon halos.
- **Modals get `shadow-2xl`** to sit decisively above the page.

### Transparency & blur

- **Cards: 20–60% white** layered on the slate-50 canvas. Lower opacity for
  decorative wrappers, higher opacity for nested rails and form fields.
- **Modal scrim:** `bg-black/60` + `backdrop-blur-sm`. This is the only
  place `backdrop-blur` appears.
- **Toasts** are solid (`bg-slate-900`, `bg-red-600`, `bg-green-600`, etc.)
  — they're meant to read instantly, not float.

### Buttons

- **Primary CTA:** `bg-team-primary`, `text-team-tertiary`, `rounded-xl`,
  `font-black`, `text-xs uppercase tracking-widest`, `shadow-md/lg`,
  `hover:-translate-y-0.5`.
- **Secondary:** `bg-white/80` or `bg-white/60`, `border border-slate-200`,
  `text-slate-700/800`, hover → `bg-white`.
- **Ghost/icon:** transparent → `bg-white/80` on hover.
- **Tab pill:** rounded-full chip; active state swaps to
  `bg-team-secondary` + `text-team-primary` + `border-team-primary`.

### Hover / press states

- **Hover lift:** primary buttons and dashboard cards translate up `0.5px`
  on hover (`hover:-translate-y-0.5`). Tap targets *never* shrink.
- **Hover wash:** secondary buttons swap from `bg-white/x` to a slightly
  more opaque `bg-white`. Background opacity steps are the dominant hover
  signal.
- **Hover tint on text:** player-name buttons in the leaderboard cards go
  `hover:text-blue-600` (a hardcoded info-600, not the team primary).
- **Press:** no scale-down; the lift is the affordance. Active tabs hold
  their hover style indefinitely.
- **Focus:** `focus:ring-2 focus:ring-blue-500` on every form input.

### Motion

- **Duration:** 150–300ms across the board (`transition-colors`,
  `transition-transform duration-200/300`).
- **Easing:** browser default (`ease-out` equivalent). No spring physics, no
  bounce.
- **Toast entry:** `slide-in-from-right` from the top-right corner.
- **Loading spin:** `animate-spin` on the sync `Refresh` icon while
  saving/creating. That's the only sustained animation in the product.
- **No page transitions, no scroll-linked animation.**

### Imagery vibe

- The product is **chromeless on imagery** — there is no stock photography,
  no hero shot, no marketing visuals in-app. The only image surface is the
  user-uploaded team logo, which appears at small sizes (16–80px squares,
  `object-contain`, transparent background expected).

### Iconography

Documented in `ICONOGRAPHY.md` and laid out in `preview/06-iconography*.html`.
TL;DR — the system uses **lucide-react** for everything generic and **five
custom SVG glyphs** (HomePlate, Jersey, Bat, Glove, Pitch) for
baseball-specific use cases. No emoji except the single `⚡` Big Game flag.

---

## Substitutions (flagged for the user)

> The following choices need your confirmation before this design system is
> "production-ready":
>
> 1. **Font:** the source ships no webfont and relies on the OS default
>    sans-serif. We substituted **Inter** (Google Fonts) as the closest free
>    analogue. If you want a different family — Geist, Manrope, IBM Plex
>    Sans, or a paid face — tell me and I'll swap it in `colors_and_type.css`.
> 2. **Brand name:** the page title is *Coach's Card*, the login title is
>    *Lineup Generator*, the GitHub repo is *lineuptool*. The design system
>    is named after the page title. Confirm or rename.
> 3. **Logo:** no team-agnostic product logo exists. We use the favicon
>    SVG from `public/index.html` (a baseball with red stitching) as the
>    placeholder product mark in `assets/`. Replace whenever you have a real
>    one.
> 4. **Icons:** [`lucide-react`](https://lucide.dev) is loaded from CDN in
>    the design system. The five custom baseball SVGs are inlined verbatim
>    from `src/icons.tsx`.

---

## UI kits

| Kit | What it is |
| --- | --- |
| `ui_kits/coachs-card-app/` | The web app. Includes Dashboard, Roster, In-Game, Settings, plus a Component Library page (buttons, inputs, badges, cards, modal). `index.html` is a click-through prototype that demonstrates the visual system end to end. |

---

## SKILL

Read `SKILL.md` for the agent-skill front-matter. The file is structured so
this whole folder can be downloaded and dropped into Claude Code as a
reusable skill.
