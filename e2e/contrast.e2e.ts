import { test, expect } from "@playwright/test";
import { SCREENS, blockOutsideRequests } from "./support";

// Every screen in BOTH themes: text has to be readable against what is behind
// it (WCAG AA — 4.5:1, or 3:1 for large text). Light mode in particular had
// drifted: green "win" text at 2.9:1 across ~100 places, a row of result chips
// whose background class didn't exist (white on white), and section headings
// dark-on-dark in the live game.
//
// Skipped, because the answer can't be computed or doesn't apply:
//   - text over a gradient or image (player avatars, the finance summary);
//   - anything dimmed by opacity — disabled controls, absent players.
//
// Runs once, in its own "themes" project (see playwright.config.ts): colour
// doesn't change with the width of the screen.

for (const theme of ["light", "dark"] as const) {
  for (const screen of SCREENS) {
    test(`${screen.name} — ${theme}`, async ({ page }) => {
      await blockOutsideRequests(page);
      await page.addInitScript((t) => {
        try {
          localStorage.setItem("cc.theme", t);
        } catch {
          // storage blocked: the app falls back to its default theme
        }
      }, theme);
      await page.goto(screen.path);
      await page
        .waitForLoadState("networkidle", { timeout: 8_000 })
        .catch(() => {});
      await page.waitForTimeout(250);

      const unreadable = await page.evaluate(() => {
        type RGBA = { r: number; g: number; b: number; a: number };
        const parse = (css: string): RGBA | null => {
          const m = css.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const [r, g, b, a] = m[1]
            .split(/[,\s/]+/)
            .filter(Boolean)
            .map(Number);
          return { r, g, b, a: a === undefined ? 1 : a };
        };
        const luminance = ({ r, g, b }: RGBA) => {
          const channel = (v: number) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return (
            0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
          );
        };
        const over = (top: RGBA, bottom: RGBA): RGBA => ({
          r: top.r * top.a + bottom.r * (1 - top.a),
          g: top.g * top.a + bottom.g * (1 - top.a),
          b: top.b * top.a + bottom.b * (1 - top.a),
          a: 1,
        });

        const found: string[] = [];
        const seen = new Set<Element>();
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = (node.nodeValue || "").trim();
          const el = node.parentElement;
          if (!text || !el || seen.has(el)) continue;
          seen.add(el);
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (style.visibility === "hidden") continue;

          // Walk up: collect background layers until an opaque one, and note
          // anything that makes the real background unknowable or the text
          // deliberately dim.
          const layers: RGBA[] = [];
          let dimmed = false;
          let pictured = false;
          let opaque = false;
          for (let n: Element | null = el; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (Number(cs.opacity) < 1) dimmed = true;
            if (!opaque) {
              if (cs.backgroundImage !== "none") pictured = true;
              const bg = parse(cs.backgroundColor);
              if (bg && bg.a > 0) {
                layers.push(bg);
                if (bg.a >= 1) opaque = true;
              }
            }
          }
          if (dimmed || pictured) continue;

          let background: RGBA = { r: 255, g: 255, b: 255, a: 1 };
          for (let i = layers.length - 1; i >= 0; i--)
            background = over(layers[i], background);
          const color = parse(style.color);
          if (!color) continue;
          const foreground = over(color, background);
          const [hi, lo] = [luminance(foreground), luminance(background)].sort(
            (a, b) => b - a,
          );
          const ratio = (hi + 0.05) / (lo + 0.05);

          const px = parseFloat(style.fontSize);
          const bold = Number(style.fontWeight) >= 700;
          const large = px >= 24 || (bold && px >= 18.66);
          if (ratio < (large ? 3 : 4.5))
            found.push(
              `"${text.slice(0, 30)}" ${ratio.toFixed(2)}:1 — ${style.color} on rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`,
            );
        }
        return found;
      });

      expect(unreadable, "text too faint to read").toEqual([]);
    });
  }
}
