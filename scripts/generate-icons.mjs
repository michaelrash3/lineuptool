// Rasterizes public/icon-source.svg and public/icon-maskable-source.svg
// into the PNGs the PWA manifest + Apple touch link reference.
//
// Run from repo root with:
//   npm install --no-save sharp && node scripts/generate-icons.mjs
//
// Only the resulting PNGs are committed; sharp is intentionally NOT a
// devDependency since this regeneration is rare.

import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicDir = resolve(root, "public");

const anySvg = await readFile(resolve(publicDir, "icon-source.svg"));
const maskableSvg = await readFile(
  resolve(publicDir, "icon-maskable-source.svg"),
);

const targets = [
  { src: anySvg, size: 192, out: "icon-192.png" },
  { src: anySvg, size: 512, out: "icon-512.png" },
  { src: maskableSvg, size: 192, out: "icon-maskable-192.png" },
  { src: maskableSvg, size: 512, out: "icon-maskable-512.png" },
  { src: maskableSvg, size: 180, out: "apple-touch-icon.png" },
  { src: anySvg, size: 32, out: "favicon-32.png" },
  { src: anySvg, size: 16, out: "favicon-16.png" },
];

for (const { src, size, out } of targets) {
  const buf = await sharp(src, { density: 512 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(publicDir, out), buf);
  console.log(`wrote public/${out} (${buf.length} bytes)`);
}
