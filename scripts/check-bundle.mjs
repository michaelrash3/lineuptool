// Fails the build when a heavy dependency lands in the eager startup graph, or
// when that graph outgrows its byte ceiling. jspdf, recharts and qrcode are all
// behind `await import(...)` / React.lazy today; nothing but this check stops a
// stray static import from silently pulling ~700 KB back into first paint.
//
// Run from repo root AFTER a production build:
//   npm run build && npm run check:bundle
//
// The eager graph is exactly what dist/index.html tells the browser to fetch
// before the app renders: the entry <script type="module"> plus every
// <link rel="modulepreload"> Vite emits for its static-import closure. A
// dependency reachable only through a dynamic import lands in some other chunk
// and never appears here — which is the distinction this check exists to make.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const assets = resolve(dist, "assets");

// Each dependency is detected by a string its own minified code always
// contains: an internal error message, a CSS class it emits, a public option
// name. Matching "jspdf" or a chunk filename instead would flag the
// `import("jspdf")` call site itself — precisely the shape we want to allow.
const FORBIDDEN = [
  {
    dep: "jspdf",
    markers: ["jsPDF.context2d", "jsPDF.roundToPrecision"],
    fix: 'keep it behind `await import("jspdf")` inside the render function',
  },
  {
    dep: "recharts",
    markers: ["recharts-wrapper", "recharts-surface"],
    fix: "draw charts from a React.lazy() screen so recharts stays in a lazy chunk",
  },
  {
    dep: "qrcode",
    markers: ["toSJISFunc"],
    fix: "keep QR generation behind the lazy QRCodeImg component",
  },
];

// Raw (uncompressed) bytes of every JS file in the eager graph. Uncompressed is
// the number that stays stable across toolchain versions; gzip/brotli is what
// actually ships, and bundle-stats.html shows that split.
//
// The eager graph measured 1,012 KiB when this guard was written (firebase and
// react-vendor are two thirds of it). The ceiling leaves ~11% headroom so
// ordinary feature work doesn't trip it. Raising it is meant to be deliberate:
// open bundle-stats.html first, confirm the growth is app code rather than a
// vendor that should have been lazy, then bump this in its own commit.
const MAX_EAGER_BYTES = 1_150_000;

const kib = (bytes) => `${Math.round(bytes / 1024)} KiB`;

const html = await readFile(resolve(dist, "index.html"), "utf8").catch(() => {
  console.error(
    "check:bundle — dist/index.html is missing. Run `npm run build` first.",
  );
  process.exit(1);
});

const chunks = new Map();
for (const name of await readdir(assets)) {
  if (name.endsWith(".js"))
    chunks.set(
      `/assets/${name}`,
      await readFile(resolve(assets, name), "utf8"),
    );
}

const entryScripts = html.matchAll(
  /<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g,
);
const modulePreloads = html.matchAll(
  /<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g,
);
const eager = [
  ...new Set([...entryScripts, ...modulePreloads].map((m) => m[1])),
].filter((path) => path.endsWith(".js"));

const problems = [];

// A parse that quietly matched nothing would make every assertion below pass
// vacuously, so prove the shape of the HTML first.
if (!eager.some((path) => /^\/assets\/index-[^/]+\.js$/.test(path)))
  problems.push(
    "dist/index.html exposes no /assets/index-*.js module entry — the build output changed shape and this script can no longer see the startup graph.",
  );

for (const path of eager)
  if (!chunks.has(path))
    problems.push(`${path} is referenced by dist/index.html but not on disk.`);

for (const { dep, markers, fix } of FORBIDDEN) {
  const hit = (path) => markers.some((m) => chunks.get(path)?.includes(m));
  const offenders = eager.filter(hit);

  for (const path of offenders)
    problems.push(
      `${dep} is in the eager startup graph — found in ${path}, which loads before first paint. Fix: ${fix}.`,
    );

  // A marker that no longer matches anywhere means this rule stopped detecting
  // anything, which looks identical to "all clear". Fail loudly instead.
  if (offenders.length === 0 && ![...chunks.keys()].some(hit))
    problems.push(
      `${dep}: none of its markers (${markers.join(", ")}) appear anywhere in dist/assets. Either the dependency is gone — drop this rule — or minification renamed the marker and this rule is now blind.`,
    );
}

const totalBytes = eager.reduce(
  (sum, path) => sum + Buffer.byteLength(chunks.get(path) ?? "", "utf8"),
  0,
);

if (totalBytes > MAX_EAGER_BYTES)
  problems.push(
    `eager startup graph is ${kib(totalBytes)}, over the ${kib(MAX_EAGER_BYTES)} ceiling (${eager.length} chunks: ${eager.join(", ")}). Check bundle-stats.html, then either make the new weight lazy or raise MAX_EAGER_BYTES in scripts/check-bundle.mjs deliberately.`,
  );

if (problems.length > 0) {
  console.error(`check:bundle FAILED (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `check:bundle OK — eager graph ${kib(totalBytes)} / ${kib(MAX_EAGER_BYTES)} across ${eager.length} chunks; ${FORBIDDEN.map((f) => f.dep).join(", ")} all stayed lazy.`,
);
