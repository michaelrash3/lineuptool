import { describe, expect, it } from "vitest";
import {
  addCustomEvalCategory,
  applyEvalCategoryPreset,
  CUSTOM_EVAL_CATEGORY_PREFIX,
  CUSTOM_EVAL_CATEGORY_WEIGHT,
  evalCategoryConfigPatch,
  evalCategoryIdsInUse,
  evalCategoryLabel,
  isEmptyEvalCategoryConfig,
  KID_PITCH_CATEGORY_PRESET,
  MAX_CUSTOM_EVAL_CATEGORIES,
  MAX_EVAL_CATEGORY_LABEL,
  newCustomEvalCategoryId,
  readEvalCategoryConfig,
  removeCustomEvalCategory,
  renameEvalCategory,
  resolveEvalCategories,
  scoredCustomCategories,
  setEvalCategoryHidden,
} from "./evalCategories";
import {
  EVAL_CATEGORIES,
  getEvalCategoriesForPlayer,
  getEvalCategoriesForTeam,
  handGradedCategoriesForTeam,
} from "../constants/ui";

const ids = (cats: Array<{ id: string }>) => cats.map((c) => c.id);
const withCustom = (label = "Bunting", group = "Hitting") =>
  addCustomEvalCategory(undefined, { label, group });

describe("readEvalCategoryConfig", () => {
  it("returns undefined for a team that never configured anything", () => {
    expect(readEvalCategoryConfig(undefined)).toBeUndefined();
    expect(readEvalCategoryConfig({})).toBeUndefined();
    // An all-empty config must be indistinguishable from no config — that is
    // what keeps a team that added and then removed a category byte-identical.
    expect(
      readEvalCategoryConfig({
        evalCategoryOverrides: {},
        evalCustomCategories: [],
      }),
    ).toBeUndefined();
    expect(
      readEvalCategoryConfig({
        evalCategoryOverrides: { approach: {}, speed: { hidden: false } },
      }),
    ).toBeUndefined();
  });

  it("reads renames, hides and custom categories off the team doc", () => {
    const config = readEvalCategoryConfig({
      evalCategoryOverrides: {
        approach: { label: "At Bats" },
        speed: { hidden: true },
      },
      evalCustomCategories: [
        { id: "custom_bunting", label: "Bunting", group: "Hitting" },
      ],
    });
    expect(config?.overrides?.approach?.label).toBe("At Bats");
    expect(config?.overrides?.speed?.hidden).toBe(true);
    expect(config?.custom).toEqual([
      { id: "custom_bunting", label: "Bunting", group: "Hitting" },
    ]);
  });

  it("drops a custom id that could shadow a built-in category", () => {
    // The `custom_` namespace is the guard: an unprefixed id would collide
    // with a real category and silently rewrite what its stored grades mean.
    const config = readEvalCategoryConfig({
      evalCustomCategories: [
        { id: "coachability", label: "Hustle", group: "Intangibles" },
        { id: "custom_hustle", label: "Hustle", group: "Intangibles" },
      ],
    });
    expect(ids(config!.custom!)).toEqual(["custom_hustle"]);
  });

  it("repairs junk rather than breaking the grading screen", () => {
    const config = readEvalCategoryConfig({
      evalCategoryOverrides: { bad: null, worse: 7 },
      evalCustomCategories: [
        null,
        { id: "custom_a", label: "   ", group: "Hitting" }, // blank label
        { id: "custom_b", label: "Grit", group: "Nonsense" }, // bad group
        { id: "custom_b", label: "Dup", group: "Hitting" }, // duplicate id
        { id: "custom_c", label: "x".repeat(80), group: "Hitting" },
      ],
    } as never);
    expect(ids(config!.custom!)).toEqual(["custom_b", "custom_c"]);
    expect(config!.custom![0].group).toBe("Intangibles");
    expect(config!.custom![1].label).toHaveLength(MAX_EVAL_CATEGORY_LABEL);
    expect(config!.overrides).toEqual({});
  });

  it("caps how many custom categories a team doc can carry", () => {
    const config = readEvalCategoryConfig({
      evalCustomCategories: Array.from({ length: 20 }, (_, i) => ({
        id: `custom_${i}`,
        label: `Cat ${i}`,
        group: "Hitting",
      })),
    });
    expect(config!.custom).toHaveLength(MAX_CUSTOM_EVAL_CATEGORIES);
  });
});

describe("resolveEvalCategories — the unconfigured team is untouched", () => {
  it("returns the SAME ARRAY for every no-op config", () => {
    // Identity, not equality: contract rule 1. Every downstream list and score
    // is built off this, so anything else is a behavior change.
    expect(resolveEvalCategories(EVAL_CATEGORIES)).toBe(EVAL_CATEGORIES);
    expect(resolveEvalCategories(EVAL_CATEGORIES, undefined)).toBe(
      EVAL_CATEGORIES,
    );
    expect(resolveEvalCategories(EVAL_CATEGORIES, {})).toBe(EVAL_CATEGORIES);
    expect(
      resolveEvalCategories(EVAL_CATEGORIES, { overrides: {}, custom: [] }),
    ).toBe(EVAL_CATEGORIES);
  });

  it("leaves the stock selectors alone when no config is passed", () => {
    expect(ids(getEvalCategoriesForTeam("Kid Pitch"))).toEqual(
      ids(EVAL_CATEGORIES),
    );
    expect(handGradedCategoriesForTeam("Coach Pitch")).toEqual(
      EVAL_CATEGORIES.filter((c) => !c.addOn && !c.dataDriven),
    );
  });
});

describe("resolveEvalCategories — renames", () => {
  it("changes the label and NOTHING else", () => {
    const config = renameEvalCategory(undefined, "coachability", "Buy-In");
    const out = resolveEvalCategories(EVAL_CATEGORIES, config);
    const before = EVAL_CATEGORIES.find((c) => c.id === "coachability")!;
    const after = out.find((c) => c.id === "coachability")!;
    expect(after.label).toBe("Buy-In");
    // Same id (so every stored grade still resolves), same weight, same group.
    expect(after.id).toBe(before.id);
    expect(after.weight).toBe(before.weight);
    expect(after.group).toBe(before.group);
    expect(ids(out)).toEqual(ids(EVAL_CATEGORIES));
  });

  it("clears the override when renamed back to the built-in label", () => {
    const renamed = renameEvalCategory(undefined, "coachability", "Buy-In");
    const restored = renameEvalCategory(
      renamed,
      "coachability",
      "Coachability",
      "Coachability",
    );
    expect(isEmptyEvalCategoryConfig(restored)).toBe(true);
  });

  it("keeps a hide in place when the rename is cleared", () => {
    let config = setEvalCategoryHidden(undefined, "speed", true);
    config = renameEvalCategory(config, "speed", "Wheels");
    config = renameEvalCategory(config, "speed", "", "Speed");
    expect(config.overrides?.speed).toEqual({ hidden: true });
  });
});

describe("resolveEvalCategories — hiding is forward-only", () => {
  const config = setEvalCategoryHidden(undefined, "coachability", true);

  it("drops the category from the grading list", () => {
    expect(ids(resolveEvalCategories(EVAL_CATEGORIES, config))).not.toContain(
      "coachability",
    );
  });

  it("KEEPS it for history surfaces (includeHidden)", () => {
    const history = resolveEvalCategories(EVAL_CATEGORIES, config, {
      includeHidden: true,
    });
    expect(ids(history)).toEqual(ids(EVAL_CATEGORIES));
  });

  it("keeps it in the SCORING list so old rounds keep their numbers", () => {
    // Hidden CUSTOM categories must still be scored — a round graded before
    // the hide carries a value for it, and that value must keep counting.
    const hiddenCustom = setEvalCategoryHidden(
      withCustom(),
      "custom_bunting",
      true,
    );
    expect(ids([...scoredCustomCategories(hiddenCustom)])).toEqual([
      "custom_bunting",
    ]);
  });

  it("is reversible, back to an empty config", () => {
    expect(
      isEmptyEvalCategoryConfig(
        setEvalCategoryHidden(config, "coachability", false),
      ),
    ).toBe(true);
  });
});

describe("resolveEvalCategories — added categories", () => {
  it("appends the team's own category with the fixed custom weight", () => {
    const out = resolveEvalCategories(EVAL_CATEGORIES, withCustom());
    const added = out[out.length - 1];
    expect(added.id).toBe("custom_bunting");
    expect(added.label).toBe("Bunting");
    expect(added.group).toBe("Hitting");
    expect(added.weight).toBe(CUSTOM_EVAL_CATEGORY_WEIGHT);
    expect(added.custom).toBe(true);
    expect(added.dataDriven).toBeUndefined();
    // Every built-in survives, in order, unchanged.
    expect(out.slice(0, EVAL_CATEGORIES.length)).toEqual(EVAL_CATEGORIES);
  });

  it("gates a Pitching category exactly like the built-in add-ons", () => {
    const config = withCustom("Mechanics", "Pitching");
    const pitcher = { comfortablePositions: ["P"] };
    const catcher = { comfortablePositions: ["C"] };
    const fielder = { comfortablePositions: ["SS"] };

    expect(
      ids(getEvalCategoriesForPlayer("Kid Pitch", pitcher, config)),
    ).toContain("custom_mechanics");
    // A catcher who doesn't pitch must NOT inherit the pitching category.
    expect(
      ids(getEvalCategoriesForPlayer("Kid Pitch", catcher, config)),
    ).not.toContain("custom_mechanics");
    expect(
      ids(getEvalCategoriesForPlayer("Kid Pitch", fielder, config)),
    ).not.toContain("custom_mechanics");
    // Not a kid-pitch team at all → nobody sees it.
    expect(
      ids(getEvalCategoriesForPlayer("Coach Pitch", pitcher, config)),
    ).not.toContain("custom_mechanics");
  });

  it("shows a universal category to everyone on every format", () => {
    const config = withCustom("Hustle", "Intangibles");
    expect(
      ids(getEvalCategoriesForPlayer("Coach Pitch", {}, config)),
    ).toContain("custom_hustle");
    expect(ids(handGradedCategoriesForTeam("Machine Pitch", config))).toContain(
      "custom_hustle",
    );
  });
});

describe("config CRUD", () => {
  it("namespaces every generated id and never reuses one", () => {
    const id = newCustomEvalCategoryId("Bunting & Bat Control");
    expect(id.startsWith(CUSTOM_EVAL_CATEGORY_PREFIX)).toBe(true);
    expect(newCustomEvalCategoryId("Bunting", [id])).not.toBe(id);
    expect(newCustomEvalCategoryId("Bunting", ["custom_bunting"])).toBe(
      "custom_bunting-2",
    );
    expect(newCustomEvalCategoryId("!!!")).toBe("custom_category");
  });

  it("refuses a blank label and stops at the cap", () => {
    expect(
      addCustomEvalCategory(undefined, { label: "  " }).custom,
    ).toBeUndefined();
    let config = {} as ReturnType<typeof addCustomEvalCategory>;
    for (let i = 0; i < MAX_CUSTOM_EVAL_CATEGORIES + 3; i++) {
      config = addCustomEvalCategory(config, { label: `Cat ${i}` });
    }
    expect(config.custom).toHaveLength(MAX_CUSTOM_EVAL_CATEGORIES);
  });

  it("removes a custom category and its override together", () => {
    let config = withCustom();
    config = renameEvalCategory(config, "custom_bunting", "Bunt Game");
    config = removeCustomEvalCategory(config, "custom_bunting");
    expect(isEmptyEvalCategoryConfig(config)).toBe(true);
  });

  it("writes both fields on every patch so a removal actually lands", () => {
    expect(evalCategoryConfigPatch(withCustom())).toEqual({
      evalCategoryOverrides: {},
      evalCustomCategories: [
        { id: "custom_bunting", label: "Bunting", group: "Hitting" },
      ],
    });
    expect(evalCategoryConfigPatch(undefined)).toEqual({
      evalCategoryOverrides: {},
      evalCustomCategories: [],
    });
  });

  it("round-trips a config through the team doc unchanged", () => {
    const config = setEvalCategoryHidden(
      renameEvalCategory(withCustom(), "speed", "Wheels"),
      "coachability",
      true,
    );
    expect(readEvalCategoryConfig(evalCategoryConfigPatch(config))).toEqual(
      config,
    );
  });
});

describe("evalCategoryIdsInUse — the delete guard", () => {
  const rounds = [
    {
      id: "r1",
      date: "2026-03-01",
      grades: {
        p1: {
          approach: 4,
          custom_bunting: 5,
          notes: "a",
          suggestedPositions: ["P"],
        },
      },
    },
    { id: "r2", date: "2026-04-01", grades: { p2: { speed: 3 } } },
  ];

  it("collects every graded id and skips the non-grade fields", () => {
    const used = evalCategoryIdsInUse(rounds as never);
    expect(used.has("custom_bunting")).toBe(true);
    expect(used.has("approach")).toBe(true);
    expect(used.has("speed")).toBe(true);
    expect(used.has("notes")).toBe(false);
    expect(used.has("suggestedPositions")).toBe(false);
  });

  it("is empty for a team with no rounds", () => {
    expect(evalCategoryIdsInUse(undefined).size).toBe(0);
    expect(evalCategoryIdsInUse([{ id: "r", date: "d" }] as never).size).toBe(
      0,
    );
  });
});

describe("evalCategoryLabel", () => {
  it("prefers the rename, then the catalog, then the custom list, then the id", () => {
    const config = renameEvalCategory(withCustom(), "approach", "At Bats");
    expect(evalCategoryLabel("approach", EVAL_CATEGORIES, config)).toBe(
      "At Bats",
    );
    expect(evalCategoryLabel("speed", EVAL_CATEGORIES, config)).toBe("Speed");
    // A custom id resolves even against the stock catalog…
    expect(evalCategoryLabel("custom_bunting", EVAL_CATEGORIES, config)).toBe(
      "Bunting",
    );
    // …and an id nobody knows (a dropped legacy key) shows itself, never blank.
    expect(evalCategoryLabel("plateDiscipline", EVAL_CATEGORIES)).toBe(
      "plateDiscipline",
    );
  });
});

describe("kid-pitch preset (opt-in, never a default)", () => {
  it("adds nothing until a coach asks for it", () => {
    // The stock catalog is untouched by the preset's existence.
    expect(ids(EVAL_CATEGORIES)).not.toContain("custom_mechanics");
  });

  it("adds the preset categories as ordinary custom, pitcher-gated ones", () => {
    const config = applyEvalCategoryPreset(
      undefined,
      KID_PITCH_CATEGORY_PRESET,
    );
    expect(config.custom).toHaveLength(KID_PITCH_CATEGORY_PRESET.length);
    const forPitcher = getEvalCategoriesForPlayer(
      "Kid Pitch",
      { comfortablePositions: ["P"] },
      config,
    );
    for (const p of KID_PITCH_CATEGORY_PRESET) {
      expect(forPitcher.some((c) => c.label === p.label)).toBe(true);
    }
    expect(
      getEvalCategoriesForPlayer(
        "Kid Pitch",
        { comfortablePositions: ["SS"] },
        config,
      ).length,
    ).toBe(
      getEvalCategoriesForPlayer("Kid Pitch", { comfortablePositions: ["SS"] })
        .length,
    );
  });

  it("is idempotent — applying twice does not duplicate", () => {
    const once = applyEvalCategoryPreset(undefined, KID_PITCH_CATEGORY_PRESET);
    const twice = applyEvalCategoryPreset(once, KID_PITCH_CATEGORY_PRESET);
    expect(twice.custom).toHaveLength(once.custom!.length);
  });
});
