# Iconography

Coach's Card uses two icon families and a small sanctioned emoji set.
No other glyphs appear in the product.

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

### Usage rules

- **Stroke icons only.** Lucide ships as 2px outlined glyphs at 24×24.
  Never increase stroke width or fill them.
- **Always sized in Tailwind:** `w-3.5 h-3.5` (14px) in chip buttons,
  `w-4 h-4` (16px) in nav and meta rows, `w-5 h-5` (20px) at section
  headers, `w-6 h-6` (24px) on tab/section heroes.
- **Always paired with text** in chrome (`<Icon /> Label`). Standalone
  icons appear only in modal close buttons and toast dismissers.
- **Tint with `currentColor`.** When the team-primary color is needed
  the call site passes `style={{ color: 'var(--team-primary)' }}`
  directly on the SVG.

## 2. Twemoji for sport flavor

For **sport-specific glyphs** (Baseball, Glove, Trophy, Field, Big
Game, Hot Streak) the system uses [Twemoji](https://twemoji.twitter.com)
remote SVGs:

```html
<img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/svg/26be.svg"
     alt="baseball" />
```

| Concept     | Emoji | Codepoint |
|-------------|-------|-----------|
| Baseball    | ⚾    | `26be`    |
| Glove       | 🧤    | `1f9e4`   |
| Stadium     | 🏟    | `1f3df`   |
| Trophy      | 🏆    | `1f3c6`   |
| Big Game    | ⭐    | `2b50`    |
| Hot Streak  | 🔥    | `1f525`   |
| Cap         | 🧢    | `1f9e2`   |
| Confirmed   | ✅    | `2705`    |
| Roster Copy | 📋    | `1f4cb`   |

Used at 22–40px inside a navy-tinted tile for dashboard glyphs (see
`preview/06-iconography.html` and `preview/22-empty-states.html`).

## 3. Retired (do not use in new designs)

The first cut of this system shipped five hand-drawn baseball SVGs
(`HomePlate`, `Jersey`, `Bat`, `Glove`, `Pitch`) under
`assets/iconography/`. **They are retired.** Multiple rounds of
review couldn't make them read convincingly as baseball gear at the
small sizes the app uses. New designs use Twemoji sport glyphs (§2)
for flavor and Lucide (§1) for UI chrome.

The files stay in `assets/iconography/` for backward compatibility
with anywhere they were already shipped, but do not add new
references.

## 4. The favicon / product mark

`public/index.html` ships a tiny inline SVG favicon that is the only
product mark in the system: a white circle with two red stitching
arcs. We've saved it as `assets/baseball-mark.svg`. Use it (or
replace it) wherever the design needs a "Coach's Card" logo before a
team logo is available.

## 5. Sanctioned emoji vocabulary

Six emojis are part of the system's voice — used sparingly, with
specific meanings:

| Emoji | Meaning | Where it appears |
|---|---|---|
| ⭐ | Big Game | Upcoming-game card; appears with a tooltip explaining the flag |
| 🔥 | Hot Streak | Stat blocks, roster row streak chip |
| 🏆 | Season Win | Tournament / championship surfaces |
| ✅ | Confirmed | Toasts, save confirmations |
| ⚾ | Section Mark | Empty states, fun copy |
| 📋 | Roster Copy | Empty states, fun copy |

**Retired:** ⚡ (too generic — replaced by ⭐) and 🎯 (overused). Do
not reintroduce.

## 6. Unicode glyphs

- `•` and `|` are *not* used as decorative separators except as a
  faded `<span className="text-slate-300">|</span>` pipe between
  meta items, and only there.
- No arrows, no checkmarks-as-text, no stars-as-text. Anywhere those
  concepts appear they're rendered as Lucide SVGs or sanctioned
  emoji from §5.

## 7. Substitution policy for designs

If you need an icon that's not in Lucide and not in the sanctioned
emoji set:

1. Check Lucide first — it has ~1500 icons.
2. For a sport-specific concept, check Twemoji for an existing emoji
   and render it remotely (§2).
3. Don't author new custom SVGs — the retired baseball glyphs are
   the cautionary tale. The visual rhythm depends on every icon
   having the same stroke personality (Lucide) or the same painted
   personality (Twemoji), not both at once.
