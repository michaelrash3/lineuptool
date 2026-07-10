import { describe, it, expect, beforeEach } from "vitest";
import {
  HELP_CATEGORIES,
  HELP_TOPICS,
  TAB_TO_HELP_CATEGORY,
  getHelpTopic,
  visibleHelpTopics,
  searchHelpTopics,
  HelpTopic,
} from "./content";
import { getCompletedTours, markTourComplete } from "./helpPrefs";
import { TAB_TO_PATH } from "../hooks/useMainShellRouting";
import { TOGGLEABLE_FEATURES } from "../constants/features";
import { Icons } from "../icons";

// Tabs an assistant coach can never reach — a CTA into one of these is only
// valid on a topic that's hidden from assistants (headOnly).
const HEAD_ONLY_TABS = new Set([
  "settings",
  "finances",
  "interest",
  "playerInfo",
  "availability",
]);

describe("help content integrity", () => {
  it("has unique topic ids", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique category ids and non-empty labels/blurbs/icons", () => {
    const ids = HELP_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of HELP_CATEGORIES) {
      expect(c.label.trim()).not.toBe("");
      expect(c.blurb.trim()).not.toBe("");
      expect(Icons[c.icon], `category ${c.id} icon "${c.icon}"`).toBeDefined();
    }
  });

  it("orders categories getting-started first, glossary last", () => {
    expect(HELP_CATEGORIES[0].id).toBe("getting-started");
    expect(HELP_CATEGORIES[HELP_CATEGORIES.length - 1].id).toBe("glossary");
  });

  it("every related id resolves via getHelpTopic", () => {
    for (const t of HELP_TOPICS) {
      for (const rel of t.related || []) {
        expect(getHelpTopic(rel), `${t.id} → related "${rel}"`).toBeDefined();
      }
    }
  });

  it("every cta.tab is a real tab id", () => {
    for (const t of HELP_TOPICS) {
      if (!t.cta) continue;
      expect(
        Object.prototype.hasOwnProperty.call(TAB_TO_PATH, t.cta.tab),
        `${t.id} → cta tab "${t.cta.tab}"`,
      ).toBe(true);
    }
  });

  it("every featureId is a toggleable feature id", () => {
    const featureIds = new Set(TOGGLEABLE_FEATURES.map((f) => f.id));
    for (const t of HELP_TOPICS) {
      if (!t.featureId) continue;
      expect(featureIds.has(t.featureId), `${t.id} → "${t.featureId}"`).toBe(
        true,
      );
    }
  });

  it("a CTA into a head-only tab requires headOnly on the topic", () => {
    for (const t of HELP_TOPICS) {
      if (!t.cta || !HEAD_ONLY_TABS.has(t.cta.tab)) continue;
      expect(t.headOnly, `${t.id} → cta into "${t.cta.tab}"`).toBe(true);
    }
  });

  it("a CTA into a feature-gated tab requires the matching featureId", () => {
    const featureIds = new Set<string>(TOGGLEABLE_FEATURES.map((f) => f.id));
    for (const t of HELP_TOPICS) {
      if (!t.cta || !featureIds.has(t.cta.tab)) continue;
      expect(t.featureId, `${t.id} → cta into "${t.cta.tab}"`).toBe(t.cta.tab);
    }
  });

  it("every topic belongs to a declared category, every category has topics", () => {
    const categoryIds = new Set(HELP_CATEGORIES.map((c) => c.id));
    const used = new Set<string>();
    for (const t of HELP_TOPICS) {
      expect(categoryIds.has(t.category), `${t.id} → "${t.category}"`).toBe(
        true,
      );
      used.add(t.category);
    }
    for (const c of HELP_CATEGORIES) {
      expect(used.has(c.id), `category "${c.id}" has no topics`).toBe(true);
    }
  });

  it("every topic has a title, summary, keywords, and at least one section", () => {
    for (const t of HELP_TOPICS) {
      expect(t.title.trim(), t.id).not.toBe("");
      expect(t.summary.trim(), t.id).not.toBe("");
      expect(t.keywords.trim(), t.id).not.toBe("");
      expect(t.sections.length, t.id).toBeGreaterThanOrEqual(1);
      for (const s of t.sections) expect(s.body.trim(), t.id).not.toBe("");
    }
  });

  it("stays inside the 30-40 topic budget", () => {
    expect(HELP_TOPICS.length).toBeGreaterThanOrEqual(30);
    expect(HELP_TOPICS.length).toBeLessThanOrEqual(40);
  });

  it("TAB_TO_HELP_CATEGORY covers every tab with a valid category", () => {
    const categoryIds = new Set(HELP_CATEGORIES.map((c) => c.id));
    for (const tab of Object.keys(TAB_TO_PATH)) {
      const cat = TAB_TO_HELP_CATEGORY[tab];
      expect(cat, `tab "${tab}" unmapped`).toBeDefined();
      expect(categoryIds.has(cat), `tab "${tab}" → "${cat}"`).toBe(true);
    }
  });
});

describe("visibleHelpTopics", () => {
  it("shows everything to a head coach with all features on", () => {
    expect(visibleHelpTopics(null, "head")).toEqual(HELP_TOPICS);
    expect(visibleHelpTopics({ disabledFeatures: [] }, null)).toEqual(
      HELP_TOPICS,
    );
  });

  it("hides headOnly topics from assistants", () => {
    const visible = visibleHelpTopics(null, "assistant");
    expect(visible.some((t) => t.headOnly)).toBe(false);
    // Non-headOnly topics survive untouched, in order.
    expect(visible).toEqual(HELP_TOPICS.filter((t) => !t.headOnly));
    // Sanity: the fixture actually exercises the gate.
    expect(visible.length).toBeLessThan(HELP_TOPICS.length);
  });

  it("hides a feature's topics when the team disabled it", () => {
    const team = { disabledFeatures: ["finances", "stats"] };
    const visible = visibleHelpTopics(team, "head");
    expect(
      visible.some(
        (t) => t.featureId === "finances" || t.featureId === "stats",
      ),
    ).toBe(false);
    // Other feature-gated topics are unaffected.
    expect(visible.some((t) => t.featureId === "tryouts")).toBe(true);
  });

  it("applies both gates at once", () => {
    const visible = visibleHelpTopics(
      { disabledFeatures: ["practices"] },
      "assistant",
    );
    expect(visible.some((t) => t.headOnly || t.featureId === "practices")).toBe(
      false,
    );
  });
});

describe("searchHelpTopics", () => {
  const makeTopic = (
    id: string,
    title: string,
    keywords = "",
    body = "",
  ): HelpTopic => ({
    id,
    category: "getting-started",
    title,
    summary: "",
    keywords,
    sections: [{ body }],
  });

  it("ranks a title match above a body-only match", () => {
    const bodyHit = makeTopic(
      "body",
      "Nothing here",
      "",
      "tap any cell to swap",
    );
    const titleHit = makeTopic("title", "Tap to swap players");
    const results = searchHelpTopics([bodyHit, titleHit], "swap");
    expect(results.map((t) => t.id)).toEqual(["title", "body"]);
  });

  it("ranks a keyword match between title and body matches", () => {
    const results = searchHelpTopics(
      [
        makeTopic("body", "xxx", "xxx", "swap here"),
        makeTopic("kw", "xxx", "swap", "xxx"),
        makeTopic("title", "swap", "xxx", "xxx"),
      ],
      "swap",
    );
    expect(results.map((t) => t.id)).toEqual(["title", "kw", "body"]);
  });

  it("drops topics where all three components miss", () => {
    const miss = makeTopic("miss", "xxx", "xxx", "xxx");
    const hit = makeTopic("hit", "batting order");
    expect(searchHelpTopics([miss, hit], "batting")).toEqual([hit]);
    expect(searchHelpTopics([miss], "batting")).toEqual([]);
  });

  it("a single component miss does not drop a topic the others match", () => {
    // Title misses "swap" entirely; body carries it.
    const t = makeTopic("only-body", "xxx", "xxx", "swap");
    expect(searchHelpTopics([t], "swap")).toEqual([t]);
  });

  it("caps results at 12, keeping the best-ranked", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      // Later topics match earlier in the title → better (lower) score.
      makeTopic(`t${i}`, `${"x".repeat(15 - i)} swap`),
    );
    const results = searchHelpTopics(many, "swap");
    expect(results).toHaveLength(12);
    expect(results[0].id).toBe("t14");
    expect(results.map((t) => t.id)).not.toContain("t0");
  });

  it("is stable: equal scores keep input order", () => {
    const a = makeTopic("a", "swap");
    const b = makeTopic("b", "swap");
    expect(searchHelpTopics([a, b], "swap").map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("returns the input list unchanged for an empty or whitespace query", () => {
    expect(searchHelpTopics(HELP_TOPICS, "")).toBe(HELP_TOPICS);
    expect(searchHelpTopics(HELP_TOPICS, "   ")).toBe(HELP_TOPICS);
  });

  it("finds real topics by title", () => {
    const results = searchHelpTopics(HELP_TOPICS, "batting order");
    expect(results[0].id).toBe("batting-order");
    expect(results.length).toBeLessThanOrEqual(12);
  });
});

describe("helpPrefs completed tours", () => {
  const KEY = "lineuptool.help.completedTours.v1";

  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips through localStorage", () => {
    expect(getCompletedTours()).toEqual([]);
    markTourComplete("lineups");
    expect(getCompletedTours()).toEqual(["lineups"]);
    markTourComplete("in-game");
    expect(getCompletedTours()).toEqual(["lineups", "in-game"]);
    expect(JSON.parse(localStorage.getItem(KEY) || "[]")).toEqual([
      "lineups",
      "in-game",
    ]);
  });

  it("is idempotent — marking the same tour twice stores it once", () => {
    markTourComplete("lineups");
    markTourComplete("lineups");
    expect(getCompletedTours()).toEqual(["lineups"]);
  });

  it("survives corrupted storage", () => {
    localStorage.setItem(KEY, "not json{");
    expect(getCompletedTours()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify({ nope: true }));
    expect(getCompletedTours()).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify(["ok", 7, null]));
    expect(getCompletedTours()).toEqual(["ok"]);
    // And a write after corruption recovers cleanly.
    localStorage.setItem(KEY, "not json{");
    markTourComplete("fresh");
    expect(getCompletedTours()).toEqual(["fresh"]);
  });
});
