import { describe, it, expect } from "vitest";
import { parseRosterLines } from "./rosterPaste";

describe("parseRosterLines", () => {
  it("reads the shapes coaches paste", () => {
    expect(
      parseRosterLines(
        [
          "12 Ada Lopez",
          "#7 Ben Cruz",
          "3. Cara Diaz",
          "21 - Dev Patel",
          "Eli Moss 9",
          "Fay Wong, 14",
          "Gus Hart #2",
          "Hana Ito",
          "  • Ivy Chen  ",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "Ada Lopez", number: "12" },
      { name: "Ben Cruz", number: "7" },
      { name: "Cara Diaz", number: "3" },
      { name: "Dev Patel", number: "21" },
      { name: "Eli Moss", number: "9" },
      { name: "Fay Wong", number: "14" },
      { name: "Gus Hart", number: "2" },
      { name: "Hana Ito", number: "" },
      { name: "Ivy Chen", number: "" },
    ]);
  });
  it("skips blank lines, number-only lines and repeated names", () => {
    expect(parseRosterLines("\n12\nAda Lopez\n\nada lopez\n")).toEqual([
      { name: "Ada Lopez", number: "" },
    ]);
  });
});
