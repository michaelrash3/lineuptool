# Iconography

Coach's Card mixes two icon systems and adds exactly one emoji. No other
glyphs appear anywhere in the product.

## 1. Lucide React (the workhorse)

The codebase imports **31 named icons** from
[`lucide-react`](https://lucide.dev) in `src/icons.tsx`, then re-exports them
under the central `Icons` object. Every screen uses `Icons.XYZ` rather than
importing lucide directly — change the source map once and the whole app
follows.

Icons used:

```
Calendar, Clipboard, Settings, Users, UserPlus, User,
Upload, Download, Save, Edit, Trash (Trash2),
Plus, Minus, Check, X,
ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
Clock, MapPin, Cloud, FileText,
Lock, Unlock, Refresh (RefreshCw), Printer,
Alert (AlertTriangle), Forward, Link
```

Two aliases worth remembering:

| Call site | Lucide source |
| --- | --- |
| `Icons.Trash`   | `Trash2` |
| `Icons.Refresh` | `RefreshCw` |
| `Icons.Alert`   | `AlertTriangle` |

### Usage rules

- **Stroke icons only.** Lucide ships as 2px outlined glyphs at 24×24. The
  app never increases stroke width or fills them.
- **Always sized in Tailwind:** `w-3.5 h-3.5` (14px) inside chip buttons,
  `w-4 h-4` (16px) in nav and meta rows, `w-5 h-5` (20px) at section
  headers, `w-6 h-6` (24px) on tab/section heroes, `w-10 h-10` (40px) on
  login.
- **Always paired with text** in chrome (`<Icon /> Label`). Standalone
  icons appear only in modal close buttons and toast dismissers.
- **Tint with `currentColor`.** When the team-primary color is needed the
  call site passes `style={{ color: primaryColor }}` directly on the SVG.

### CDN

The system loads `lucide-react` from npm in production. For static design
deliverables that don't ship a React bundle, link the SVG sprite from CDN
instead:

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
<i data-lucide="calendar"></i>
<script>lucide.createIcons();</script>
```

## 2. Custom baseball SVGs (the five)

Five baseball-specific glyphs that lucide doesn't ship. Authored inline in
`src/icons.tsx`, same 24×24 grid, same 2px stroke. We've extracted each one
to `assets/iconography/` as a standalone file so you can drop them straight
into any design.

| Name | When it's used |
| --- | --- |
| `HomePlate`  | Reserved — the project's product mark / favicon glyph. |
| `Jersey`     | The Roster tab header, empty-roster state, sub-section eyebrows. |
| `Bat`        | "Hitting Leaders" section header on Home. |
| `Glove`      | "Fielding Leaders" section header on Home, fielding stat cards. |
| `Pitch`      | "Pitching Leaders" section header (Kid Pitch only), pitching stat cards, sits inside a `bg-red-50` halo as the only red-tinted hero icon in the system. |

### Authoring rules (if you draw a 6th)

- `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
  `stroke-width="2"`, `stroke-linecap="round"`, `stroke-linejoin="round"`.
- Inner shapes use `fill="currentColor"` with `fill-opacity="0.15"` for a
  subtle wash that reads with the lucide siblings.
- Center-weighted composition — no clipped edges.

## 3. The favicon / product mark

`public/index.html` ships a tiny inline SVG favicon that is, effectively,
the only product mark in the system: a white circle with two red stitching
arcs. We've saved it as `assets/baseball-mark.svg`. Use it (or replace it)
wherever the design needs a "Coach's Card" logo before a team logo is
available.

## 4. Emoji

Exactly **one** emoji appears in the codebase:

- `⚡` — flags a game marked as "Big Game" on the upcoming-game card on
  Home. Rendered yellow with `text-yellow-500`.

Do not add others. The empty states, error toasts, and confirmation modals
deliberately do not use any.

## 5. Unicode glyphs

- `•` and `|` are *not* used as decorative separators — the app uses a
  faded `<span className="text-slate-300">|</span>` literally as a vertical
  pipe between meta items, and only there.
- No arrows, no checkmarks-as-text, no stars. Anywhere those concepts
  appear they're rendered as lucide SVGs.

## 6. Substitution policy for designs

If you need an icon that's not in the lucide set and isn't one of the five
baseball glyphs:

1. Check lucide first — it has ~1500 icons.
2. If lucide doesn't have it, draw a new one *in the baseball-SVG style*
   (24×24, 2px stroke, 0.15 fill-opacity wash) and add it to
   `assets/iconography/`.
3. Never fall back to emoji, fa-icons, material icons, or another set —
   the visual rhythm depends on every icon having the same stroke
   personality.
