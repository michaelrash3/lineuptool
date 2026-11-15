import { test, expect, type Page } from "@playwright/test";
import { SCREENS, blockOutsideRequests } from "./support";

// One test per screen, run once per viewport (see playwright.config.ts). Each
// opens the screen by its URL — the way a refresh, a bookmark or a shared link
// does — and fails on anything a coach would experience as broken:
//
//   - the page errors, or logs an error, while rendering;
//   - the screen never renders (blank page, error fallback);
//   - the URL doesn't stay where it was opened, or the app keeps navigating;
//   - the page scrolls sideways;
//   - a form control has no name for a screen reader, or two elements share
//     an id (which breaks label → field wiring);
//   - on a touch screen, something tappable is under 24px (the accessibility
//     minimum), or an icon-only control is under 44px.
//
// The team is the sample one in harness/sampleTeam.ts. Add a row here when a
// new screen gets a route.

// Console noise that isn't the app misbehaving: the harness blocks every
// request that leaves localhost, so Firebase logs that it can't connect.
const IGNORED_CONSOLE = /net::ERR_|Failed to load resource|firebase|firestore/i;

const openScreen = async (page: Page, path: string) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORED_CONSOLE.test(m.text()))
      errors.push(`console.error: ${m.text().slice(0, 300)}`);
  });

  await blockOutsideRequests(page);

  // Count every URL change the app makes, to catch a navigation loop.
  await page.addInitScript(() => {
    const counter = { changes: 0 };
    (window as any).__urlChanges = counter;
    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method].bind(history);
      history[method] = (...args: Parameters<History["pushState"]>) => {
        counter.changes++;
        return original(...args);
      };
    }
  });

  await page.goto(path);
  // Bounded, and allowed to give up: a screen stuck in a navigation loop
  // never goes idle, and the checks below should be what reports it ("the
  // app kept navigating"), not a bare timeout here.
  await page
    .waitForLoadState("networkidle", { timeout: 8_000 })
    .catch(() => {});
  // Lazy screens resolve after their chunk loads; give the last one a beat.
  await page
    .locator("#main-content")
    .waitFor({ timeout: 8_000 })
    .catch(() => {});
  await page.waitForTimeout(250);
  return errors;
};

for (const screen of SCREENS) {
  test(screen.name, async ({ page, hasTouch }) => {
    const errors = await openScreen(page, screen.path);

    expect(errors, "errors while rendering").toEqual([]);

    const state = await page.evaluate(() => {
      const main = document.querySelector("#main-content");
      const root = document.documentElement;
      const ids = new Map<string, number>();
      for (const el of document.querySelectorAll("[id]"))
        ids.set(el.id, (ids.get(el.id) || 0) + 1);
      const nameless: string[] = [];
      for (const el of document.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input:not([type=hidden]), select, textarea")) {
        const named =
          el.getAttribute("aria-label") ||
          el.getAttribute("aria-labelledby") ||
          el.getAttribute("title") ||
          (el.labels && el.labels.length > 0);
        if (!named) nameless.push(el.outerHTML.slice(0, 120));
      }
      // Tap targets, as a finger meets them. A checkbox or radio is tapped
      // through its label, so the label's box is its target. An inline link
      // inside a sentence is exempt (WCAG 2.2, 2.5.8).
      const tooSmall: string[] = [];
      const smallIcons: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        'button, a[href], [role="button"], [role="tab"], select, summary, input:not([type=hidden])',
      )) {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (box.width <= 1 || box.height <= 1) continue; // visually hidden
        if (style.visibility === "hidden" || style.display === "none") continue;
        if (el.tagName === "A" && style.display === "inline") continue;
        let { width, height } = box;
        const label = el.matches("input") ? el.closest("label") : null;
        if (label) {
          const outer = label.getBoundingClientRect();
          width = Math.max(width, outer.width);
          height = Math.max(height, outer.height);
        }
        const name = (
          el.getAttribute("aria-label") ||
          el.textContent ||
          el.getAttribute("type") ||
          el.tagName
        )
          .trim()
          .slice(0, 40);
        const size = `${Math.round(width)}x${Math.round(height)}`;
        if (width < 24 || height < 24) tooSmall.push(`${name} (${size})`);
        // Icon-only: an svg and no text. Positioned ones are overlays (a
        // badge's remove button, the help bubble) sized by their own design.
        const iconOnly =
          !el.matches("input, select") &&
          el.querySelector("svg") !== null &&
          (el.textContent || "").trim() === "" &&
          style.position !== "absolute" &&
          style.position !== "fixed";
        if (iconOnly && (width < 44 || height < 44))
          smallIcons.push(`${name} (${size})`);
      }
      return {
        tooSmall,
        smallIcons,
        text: (main?.textContent || "").trim().length,
        crashed: /something went wrong/i.test(main?.textContent || ""),
        sidewaysOverflow: root.scrollWidth - root.clientWidth,
        urlChanges: (window as any).__urlChanges.changes as number,
        duplicateIds: [...ids]
          .filter(([id, n]) => id && n > 1)
          .map(([id]) => id),
        nameless,
      };
    });

    expect(state.crashed, "the screen's error fallback is showing").toBe(false);
    if (screen.overlayShows)
      await expect(page.locator("body")).toContainText(screen.overlayShows);
    else
      expect(state.text, "the screen rendered no content").toBeGreaterThan(20);

    expect(new URL(page.url()).pathname, "the URL didn't stay put").toBe(
      screen.settlesAt ?? screen.path.split("?")[0],
    );
    // Opening a page takes the router's own setup plus at most a redirect or
    // two. A loop makes thousands.
    expect(state.urlChanges, "the app kept navigating").toBeLessThanOrEqual(5);

    expect(
      state.sidewaysOverflow,
      "the page scrolls sideways (pixels past the viewport)",
    ).toBe(0);

    // Sizes only apply where the primary pointer is a finger; under a mouse
    // the tighter layout is deliberate (see "Touch targets" in styles.css).
    if (hasTouch) {
      expect(state.tooSmall, "tap targets under 24px").toEqual([]);
      expect(state.smallIcons, "icon-only controls under 44px").toEqual([]);
    }

    expect(state.duplicateIds, "elements sharing an id").toEqual([]);
    expect(state.nameless, "form controls with no accessible name").toEqual([]);
  });
}
