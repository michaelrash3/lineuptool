# Handoff Instructions

A step-by-step guide for handing this design system to a developer
(or to Claude Code) so they can implement it inside the **Coach's
Card** production codebase (`github.com/michaelrash3/lineuptool`).

---

## What's in this folder

```
CLAUDE.md                      ← entry point for Claude Code (read-first)
CLAUDE_CODE.md                 ← longer Claude Code handoff narrative
README.md                      ← full per-screen design spec
SOURCE_README.md               ← deep visual-foundations rationale
ICONOGRAPHY.md                 ← icon library rules
colors_and_type.css            ← canonical token source (CSS variables)
assets/
  baseball-mark.svg            ← placeholder product logo
  iconography/                 ← 5 custom baseball SVGs
  team-logos/trash-pandas.png  ← example uploaded team logo
preview/
  _card.css                    ← shared card-stage CSS
  01–23-*.html                 ← 22 design reference cards (one per
                                  primitive / component / screen)
ui_kits/coachs-card-app/
  index.html                   ← click-through prototype (Login → Dashboard)
  Chrome.jsx                   ← LoginScreen, AppHeader, TabBarNav
  HomeDashboard.jsx            ← UpcomingGameCard, TeamSummary, LeaderboardCard
  mock-data.js                 ← sample team / players / games / coaches
  README.md                    ← UI kit usage notes
Trash Pandas Theme Preview.html
                               ← demonstration of the theming feature
                                  end-to-end with a real team's colors + logo
INSTRUCTIONS.md                ← this file
```

---

## Step 1 — Download & inspect

1. Download the `design_handoff_coachs_card.zip` file from the chat.
2. Unzip locally.
3. Double-click `Trash Pandas Theme Preview.html` to open it in your
   browser. **This is the "what done looks like"** — confirm the
   bundled HTML renders, the preview cards load inside the iframes,
   and the Trash Pandas raccoon logo appears as the centered
   watermark. If any iframe is blank, open it directly to confirm
   it renders standalone — some browsers block local iframe
   loading; if so, run a quick local server:

   ```sh
   cd design_handoff_coachs_card
   python3 -m http.server 8000
   # open http://localhost:8000/Trash%20Pandas%20Theme%20Preview.html
   ```

---

## Step 2 — Hand off to your developer (or Claude Code)

### Option A — Hand off to Claude Code (recommended)

1. In the project root of your `lineuptool` repo, drop this entire
   `design_handoff_coachs_card/` folder.
2. Open Claude Code in that repo.
3. Say to Claude Code:
   > Read `design_handoff_coachs_card/CLAUDE.md`, then audit the
   > repo and start with **Step 1** of the workflow in that file
   > (wire tokens into Tailwind config and `:root`). Stop and show
   > me the proposed Tailwind config diff before writing it.

Claude Code will read the files in order and follow the implementation
plan. Stop it after each step to review.

### Option B — Hand off to a human developer

Send them this folder plus a one-line README:

> Implement the designs in `design_handoff_coachs_card/` inside the
> production `lineuptool` codebase. Start with `CLAUDE.md` — it has
> the workflow.

---

## Step 3 — What to verify after implementation

Use this checklist before merging the developer's work:

### Visual fidelity
- [ ] Tab bar matches `preview/14-tab-bar.html`
- [ ] Upcoming-game card matches `preview/19-upcoming-game.html`
- [ ] Roster row matches `preview/15-roster-row.html`
- [ ] Modal matches `preview/16-modal.html`
- [ ] Stat blocks match `preview/20-stat-blocks.html`
- [ ] Leaderboard cards match `preview/18-leaderboard-card.html`

### Theming feature
- [ ] **Settings → Team Theme** screen exists, looks like
      `preview/21-theme-settings.html`, lets the user upload a logo
      and set 3 colors.
- [ ] Saving the theme writes the 3 colors + logo URL to the team's
      Firestore document.
- [ ] Reloading the app with a different team applies that team's
      colors to every screen — buttons, accent strips, active tabs,
      stat-block hero, leaderboard header, modal hero, roster
      jersey plates, etc.
- [ ] **Sanity test:** in Settings, set Primary=`#9BCBEB`,
      Secondary=`#BA0C2F`, Tertiary=`#14213D` and upload the
      `assets/team-logos/trash-pandas.png` file. Compare the live
      app to `Trash Pandas Theme Preview.html` — they should look
      essentially identical.

### Token hygiene
- [ ] Grep the codebase for the old hardcoded blue `#2563eb` — there
      should be zero matches outside of `colors_and_type.css` /
      Tailwind config defaults.
- [ ] No glass cards on dark backgrounds.
- [ ] All chrome (buttons, tabs, labels, badges, eyebrows) is
      UPPERCASE + `font-weight: 900` + wide tracking.
- [ ] `⭐` replaces `⚡` for Big Game flags.

### Iconography
- [ ] `src/icons.tsx` exports the 5 baseball SVGs from
      `assets/iconography/`.
- [ ] All other icons come from `lucide-react`.

---

## Step 4 — Adding more teams (smoke test)

Once theming is live, try at least 3 different team color triplets to
confirm the system holds up:

| Test team        | Primary  | Secondary | Tertiary |
|------------------|----------|-----------|----------|
| Trash Pandas     | #9BCBEB  | #BA0C2F   | #14213D  |
| Bright orange    | #FB923C  | #1E293B   | #FFFFFF  |
| Maroon & gold    | #7F1D1D  | #FBBF24   | #1F2937  |

For each, walk through Home → Roster → Modal → Settings. Watch for:
- Buttons that disappear (low contrast against same-color background)
- Dark text on dark backgrounds
- Heroes that feel "untouched" by the team color

Any of those = the theming layer needs one more pass.

---

## Step 5 — Outstanding visual notes (from this design session)

Some preview cards went through multiple review rounds with notes
worth preserving:

- **Iconography (card 06)** — the custom baseball SVGs (bat / glove /
  pitch) were rebuilt multiple times. The committed versions in
  `assets/iconography/` are the latest, but they may still not read
  perfectly at small sizes. If you'd rather drop them, the system
  works fine with `lucide-react` icons everywhere — the five custom
  SVGs are flavor, not load-bearing.
- **Upcoming Game (card 19)** — uses a dark navy hero gradient. When
  re-themed for teams with light primaries (Trash Pandas) this works
  beautifully; for teams with already-dark primaries, the hero may
  flatten. The override in `Trash Pandas Theme Preview.html` shows
  the contrast-aware swap pattern.
- **Modal & Stat Blocks (cards 16, 20)** — these are the surfaces
  most likely to fail dark-on-dark contrast. The committed CSS uses
  light Columbia + soft rose on dark heroes specifically to prevent
  that failure mode.

---

## Step 6 — When something looks off

If after implementation the app doesn't match the preview cards,
the most common causes (in order):

1. **Tailwind config didn't pick up the new tokens** — confirm the
   slate / emerald / rose / amber families are unmodified Tailwind
   defaults; confirm `--team-*` variables are read in CSS, not at
   build time.
2. **Hardcoded colors** in component files — grep for `bg-blue-`
   and `text-blue-`; those should be the team-primary variable now.
3. **The dark hero gradients in cards 19/20** weren't ported with the
   contrast-aware overrides — re-read the relevant CSS blocks in
   those preview files.
4. **The font isn't loading** — confirm `Inter` and `JetBrains Mono`
   are loaded from Google Fonts in `public/index.html` or wherever
   global fonts live.

---

## Step 7 — Future enhancements (not in scope here)

Things that came up during design but were intentionally not built:

- **Per-coach light/dark mode toggle.** The system has no dark
  mode. Adding one would mean recoloring every glass surface.
- **Animated logo behavior.** The logo is currently a static asset.
- **In-app theme preview without saving.** Right now Settings saves
  immediately; a "preview before save" affordance would be nice.

Discuss before scoping any of these.
