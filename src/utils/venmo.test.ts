import { describe, it, expect } from "vitest";
import { isSafeVenmoUrl, normalizeVenmoLink } from "./venmo";

describe("normalizeVenmoLink", () => {
  it("turns a handle into a Venmo link", () => {
    expect(normalizeVenmoLink("@Coach-Rash")).toEqual({
      ok: true,
      value: "https://venmo.com/u/Coach-Rash",
    });
    expect(normalizeVenmoLink("CoachRash")).toEqual({
      ok: true,
      value: "https://venmo.com/u/CoachRash",
    });
  });
  it("keeps a real Venmo URL, adding https when it was left off", () => {
    expect(normalizeVenmoLink("https://venmo.com/u/Coach")).toEqual({
      ok: true,
      value: "https://venmo.com/u/Coach",
    });
    expect(normalizeVenmoLink("account.venmo.com/u/Coach")).toEqual({
      ok: true,
      value: "https://account.venmo.com/u/Coach",
    });
  });
  it("clears on empty", () => {
    expect(normalizeVenmoLink("  ")).toEqual({ ok: true, value: "" });
  });
  it("refuses anything that isn't Venmo", () => {
    for (const bad of [
      "javascript:alert(1)",
      "http://venmo.com/u/Coach",
      "https://venmo.com.evil.example/u/Coach",
      "https://evil.example/venmo.com",
      "data:text/html,hi",
      "not a link at all",
    ])
      expect(normalizeVenmoLink(bad)).toEqual({ ok: false });
  });
});

describe("isSafeVenmoUrl", () => {
  it("only passes https Venmo hosts", () => {
    expect(isSafeVenmoUrl("https://venmo.com/u/x")).toBe(true);
    expect(isSafeVenmoUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeVenmoUrl("https://paypal.com/x")).toBe(false);
    expect(isSafeVenmoUrl(undefined)).toBe(false);
  });
});
