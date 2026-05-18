# Coach's Card — Claude Code Handoff

## Read this first

The files in this bundle are **design references created in HTML** — high-fidelity prototypes that demonstrate the intended look, behavior, and theming system of the Coach's Card design system. They are **not production code to copy directly.**

Your task is to **recreate these designs in the target codebase's existing environment** (React, React Native, SwiftUI, etc.) using its established patterns, component libraries, and conventions. The source app this design system was built against is a CRA + React project — `michaelrash3/lineuptool` on GitHub — so most patterns map 1:1 to JSX components, but the same tokens and rules apply to any framework.

## Fidelity

**High-fidelity (hifi).** Every color, spacing value, type ramp, radius, and shadow is final. Recreate the UI pixel-perfectly. Reference exact values from `colors_and_type.css`.

## What's in this bundle

| File / Folder | Purpose |
|---|---|
| `README.md` | Full design system specification — read this for tokens, components, copy patterns, behaviors |
| `ICONOGRAPHY.md` | Icon library reference (Lucide + 5 custom baseball glyphs in `assets/iconography/`) |
| `colors_and_type.css` | **Canonical token source.** All CSS variables — colors, type ramp, spacing, radii, shadows, semantic lanes, and the `--team-*` theme vars |
| `preview/01-21-*.html` | 21 design reference cards covering every primitive and composed component. Each is a working HTML demo |
| `preview/_card.css` | Shared stage CSS used by every preview |
| `ui_kits/` | React JSX implementations of the major components — use these as starting-point translations |
| `assets/` | Logo mark, team logos, icon SVGs |
| `Trash Pandas Theme Preview.html` | Demonstrates the runtime theming system applied end-to-end with a specific team's colors + logo |
| `SOURCE_README.md` | Reference notes from the original lineuptool repo |

## The headline feature: variable-driven team theming

This system was designed so that a coach can paste **3 hex colors + a logo** into a Settings screen and every surface in the app re-themes to match. The mechanism:

1. Three CSS variables drive every team-colored surface:
   - `--team-primary` — buttons, accent strips, active tabs, brand surfaces
   - `--team-secondary` — energy moments (alerts, streaks, key actions, losses)
   - `--team-tertiary` — headings, dark hero panels, deep text
2. The logo is a single asset file (`assets/team-logos/<team>.png` or `.svg`)
3. **No component-level color hardcoding** — every brand surface consumes the variables

When implementing in the real codebase:
- Surface the 3 colors + logo as fields in your existing Settings/Profile model
- Inject them as CSS custom properties on `:root` (or whatever your theming layer expects)
- Reference `preview/21-theme-settings.html` for the in-app Settings UI design
- Reference `Trash Pandas Theme Preview.html` to see how the rules cascade across all 20 other surfaces

## Implementation notes

- **Do not ship the HTML directly.** Recreate each screen using the target codebase's component library.
- **Dark-on-dark contrast rule:** when a surface sits on a dark hero (tertiary navy or similar), accents must use the lightest of the three team colors and a soft red (e.g. `#FCA5A5`) for danger states — never plain `--team-secondary` if it's a dark color. See the `.record` block in `preview/20-stat-blocks.html` for the canonical pattern.
- **Type:** Inter (display + body), JetBrains Mono (numbers + monospace). Type ramp defined in `colors_and_type.css`.
- **Spacing scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56 px.
- **Radii:** 6 / 10 / 14 / 18 / 24 px + `9999px` for pills.
- **Iconography:** Lucide for general icons, 5 custom SVGs in `assets/iconography/` for baseball-specific glyphs.

## Screens covered

01–05 Foundations · 06 Icons · 07 Buttons · 08 Forms · 09 Badges/Chips · 10 Card Anatomy · 11–13 Radii/Shadows/Spacing · 14 Tab Bar · 15 Roster Row · 16 Modal · 17 Toasts · 18 Leaderboard · 19 Upcoming Game · 20 Stat Blocks (Rich + Stripped) · 21 Team Theme Settings · 22 Empty States

Open `README.md` for the full per-component spec.

## Suggested workflow with Claude Code

1. Open the target repo in Claude Code
2. Point Claude at this folder and ask it to read `CLAUDE.md` (then `README.md` and `colors_and_type.css`)
3. Have Claude scaffold the design token layer first (extend Tailwind config + add the three `--team-*` CSS variables to `:root`)
4. Implement screen-by-screen, opening the corresponding `preview/NN-*.html` in a browser as the visual reference
5. Validate against `Trash Pandas Theme Preview.html` once the token layer is hooked up — every surface should re-theme when the three `--team-*` vars are swapped
6. Walk the verification checklist in `INSTRUCTIONS.md` before merging
