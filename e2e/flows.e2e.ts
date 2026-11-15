import { test, expect } from "@playwright/test";

// A few journeys clicked through the real app — the things a per-screen
// render check can't see, because they only exist between two screens.
// Shares the harness and sample team with screens.e2e.ts.

test.beforeEach(async ({ page }) => {
  // Nothing leaves the machine (see screens.e2e.ts).
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/_vercel/"))
      return route.fulfill({ contentType: "text/javascript", body: "" });
    return url.hostname === "localhost" ? route.continue() : route.abort();
  });
});

test("a This Week game card opens that game", async ({ page }) => {
  await page.goto("/");
  const week = page.locator("div", {
    has: page.getByRole("heading", { name: "This Week" }),
  });
  // Not the first card: the first game of the week is also the "next game"
  // hero, so opening it would pass even if every card opened the same game.
  await week
    .getByRole("button", { name: /South County Sluggers/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/schedule\/game\/u2$/);
  await expect(
    page.getByRole("heading", { name: "Game Command Center" }),
  ).toBeVisible();
  await expect(page.locator("#main-content")).toContainText(
    /vs South County Sluggers/i,
  );
});
