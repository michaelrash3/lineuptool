import fs from "fs";
import path from "path";
import { Icons } from "./icons";

// Walk the src tree and collect every `Icons.<Name>` reference. A reference to
// a key that isn't in the Icons map resolves to `undefined`, and rendering an
// undefined component throws React error #130 ("element type is invalid") —
// exactly the crash that took down the Settings tab when an icon was used but
// never added to the map. This guard fails loudly at test time instead.
const SRC_DIR = __dirname;

const collectFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...collectFiles(full));
    } else if (
      /\.(t|j)sx?$/.test(entry.name) &&
      !/\.test\.(t|j)sx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
};

describe("Icons map", () => {
  it("has no undefined entries (every lucide import resolved)", () => {
    const missing = Object.keys(Icons).filter((k) => !Icons[k]);
    expect(missing).toEqual([]);
  });

  it("defines every Icons.<Name> referenced anywhere in src", () => {
    const referenced = new Set<string>();
    for (const file of collectFiles(SRC_DIR)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/Icons\.([A-Za-z0-9_]+)/g)) {
        referenced.add(m[1]);
      }
    }
    const undefinedRefs = [...referenced].filter((name) => !Icons[name]);
    expect(undefinedRefs).toEqual([]);
  });
});
