import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { SERVICE_WORKER_URL } from "./serviceWorker";

// The bug this file guards against was invisible to any runtime test: the app
// registered "/service-worker.js" from src/index.tsx while vite-plugin-pwa
// (injectRegister: "auto") injected a registerSW.js into <head> that registered
// "/sw.js". A scope holds exactly ONE registration, so the two calls re-pointed
// it against each other on every page load — two different caching strategies
// taking turns controlling the tab. Nothing but the wiring itself can be
// asserted here, so assert the wiring.

const root = resolve(__dirname, "..", "..");
const read = (relative: string) =>
  readFileSync(resolve(root, relative), "utf8");

const sourceFiles = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) found.push(full);
  }
  return found;
};

describe("service worker wiring", () => {
  it("registers a worker from exactly one module", () => {
    const owner = resolve(root, "src/utils/serviceWorker.ts");
    const callers = sourceFiles(resolve(root, "src")).filter(
      (file) =>
        !file.endsWith(".test.ts") &&
        !file.endsWith(".test.tsx") &&
        /serviceWorker\s*\.\s*register\s*\(/.test(readFileSync(file, "utf8")),
    );

    expect(callers).toEqual([owner]);
  });

  it("lets vite-plugin-pwa build the worker but not register it", () => {
    const config = read("vite.config.ts");

    // injectRegister "auto"/"script"/"inline" all emit a registerSW.js and wire
    // it into index.html — a second registration at the same scope.
    expect(config).toMatch(/injectRegister:\s*null/);
    expect(config).not.toMatch(
      /injectRegister:\s*["'](auto|script|inline)["']/,
    );
  });

  it("builds the worker from src/service-worker.js to the URL the app registers", () => {
    const config = read("vite.config.ts");

    expect(config).toMatch(/strategies:\s*["']injectManifest["']/);
    expect(config).toMatch(/srcDir:\s*["']src["']/);
    // The emitted filename IS the registered URL. If one side is renamed
    // without the other, every client registers a 404.
    const filename = config.match(/filename:\s*["']([^"']+)["']/)?.[1];
    expect(filename).toBe(SERVICE_WORKER_URL.replace(/^\//, ""));
  });

  it("keeps the worker source's build-time precache injection point", () => {
    // Without this token, injectManifest has nowhere to write the manifest and
    // the offline precache silently becomes an empty list.
    expect(read("src/service-worker.js")).toContain("self.__WB_MANIFEST");
  });

  it("serves no second worker script out of public/", () => {
    // public/ is copied to dist/ verbatim. A worker script left there stays
    // reachable at its old URL, so a previously-registered client could keep
    // updating itself from it forever.
    for (const stale of ["public/service-worker.js", "public/sw.js"])
      expect(existsSync(resolve(root, stale))).toBe(false);
  });
});
