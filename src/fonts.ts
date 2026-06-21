// Self-hosted fonts (via @fontsource), replacing the render-blocking Google
// Fonts <link> that used to live in index.html. Two reasons this matters here:
//
//   1. Offline-first PWA: coaches use this at the field with poor/no signal. The
//      Google CDN never loads offline, so offline users silently fell back to
//      system fonts. These woff2 files are precached by the service worker
//      (workbox already globs **/*.woff2), so the real typography survives
//      offline.
//   2. No render-blocking third-party request and no fonts.googleapis.com /
//      fonts.gstatic.com round trip on first paint.
//
// Only the weights actually used are imported — Inter 400 (the body default),
// 500, 600, 700, 800, 900; JetBrains Mono 500, 700 — matching the font-* utility
// classes and the typography tokens in styles.css. The family names ("Inter",
// "JetBrains Mono") match the --font-sans / --font-mono stacks defined there.
//
// Latin subset only: the UI is English, and importing the full set drags in
// cyrillic/greek/vietnamese woff2 the browser never downloads but the service
// worker would still precache — needless weight in the offline cache.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-900.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
