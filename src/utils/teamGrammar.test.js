import { enforcePluralTeamGrammar, formatSeedOutcome } from "./teamGrammar";

describe("enforcePluralTeamGrammar", () => {
  it("converts singular team verbs to plural forms", () => {
    const input =
      "Cruzers is a strong lean: Cruzers has the stronger scoring profile and Cruzers owns the better adjusted profile. Cruzers ranges from #5 with a win to #5 with a loss.";
    const out = enforcePluralTeamGrammar(input);

    expect(out).toContain("Cruzers are a strong lean");
    expect(out).toContain("Cruzers have the stronger scoring profile");
    expect(out).toContain("Cruzers own the better adjusted profile");
    expect(out).toContain("Cruzers range from #5");
  });
});

describe("formatSeedOutcome", () => {
  it("uses locked-in wording when win/loss seeds are identical", () => {
    expect(formatSeedOutcome("Slammers", 13, 13)).toBe(
      "Slammers are currently locked in as the #13 seed"
    );
  });

  it("uses range wording when win/loss seeds differ", () => {
    expect(formatSeedOutcome("Cruzers", 5, 7)).toBe(
      "Cruzers range from #5 with a win to #7 with a loss"
    );
  });
});
