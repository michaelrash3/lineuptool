# Performance notes

The app is an offline-first PWA coaches use at the field, so the budget that
matters is the **startup graph** (what loads before the first screen) and the
**service-worker precache** (what must be cached for offline open). Everything
else is lazy: each screen is a `React.lazy` chunk, and heavy one-shot vendors
(`jspdf`, `qrcode`, `canvas-confetti`) are loaded via dynamic `import()` only
when the coach triggers the action that needs them.

## Inspecting the bundle

```bash
npm run build           # emits bundle-stats.html at the repo root (gitignored)
open bundle-stats.html  # treemap with gzip + brotli sizes
```

`rollup-plugin-visualizer` (vite.config.ts) only emits during a real build — the
dev server and Vitest are unaffected.

## Rough budget (gzipped, as of this writing)

| Chunk                   | gzip    | Notes                                              |
| ----------------------- | ------- | -------------------------------------------------- |
| `firebase`              | ~128 KB | Slow-moving vendor, stable hash across app deploys |
| `react-vendor`          | ~52 KB  | React + DOM + Router + scheduler                   |
| `index` (app entry)     | ~120 KB | Top-level shell + providers                        |
| Each screen chunk       | 4–20 KB | Lazy per route                                     |
| `jspdf` / `html2canvas` | lazy    | Only on PDF lineup-card export                     |

Guideline: if a build pushes a **new** dependency into the entry/startup graph,
the treemap will show it — keep one-shot/heavy libs behind dynamic `import()` so
they stay in their own lazy chunk.

## Fonts

Inter + JetBrains Mono are self-hosted via `@fontsource` and imported in
`src/fonts.ts` (latin subset, only the weights used). They are bundled and
service-worker precached, so typography survives offline and there is no
render-blocking Google Fonts request on first paint. Adding a new weight means
adding both the `font-*` usage and the matching `@fontsource/.../latin-NNN.css`
import.
