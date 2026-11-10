import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Security headers ship from vercel.json. Pinned here so a config edit can't
// quietly drop them:
//  - frame-ancestors / X-Frame-Options: the coach app can't be framed by
//    another site (a framed "Make Head" or "Remove" button could be
//    clickjacked).
//  - Referrer-Policy: a parent-form link's slug never leaks in full to
//    another site (origin only, cross-origin). Deliberately NOT no-referrer:
//    Firebase API keys restricted by HTTP referrer need it.
//  - A script CSP is a separate step (Firebase auth, Sentry, the inline theme
//    script); these directives restrict no scripts.
const config = JSON.parse(
  readFileSync(resolve(__dirname, "../../vercel.json"), "utf8"),
);
const headers = Object.fromEntries(
  config.headers
    .find((h: any) => h.source === "/(.*)")
    .headers.map((h: any) => [h.key.toLowerCase(), h.value]),
);

describe("vercel.json security headers", () => {
  it("can't be framed", () => {
    expect(headers["content-security-policy"]).toMatch(
      /frame-ancestors 'none'/,
    );
    expect(headers["x-frame-options"]).toBe("DENY");
  });
  it("sends origin-only referrers cross-site and no sniffing", () => {
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
  it("turns off device features the app never uses", () => {
    for (const f of ["camera=()", "microphone=()", "geolocation=()"])
      expect(headers["permissions-policy"]).toContain(f);
  });
  it("still routes the SPA and leaves /api alone", () => {
    expect(config.rewrites).toEqual([
      { source: "/((?!api/).*)", destination: "/index.html" },
    ]);
  });
});
