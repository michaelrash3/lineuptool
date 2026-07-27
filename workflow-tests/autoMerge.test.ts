import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

// The auto-merge workflow decides what lands on main without a human. Its
// hold logic (the do-not-merge label / body marker added after PRs #582-#585
// merged mid-review) was originally proven only by a throwaway harness that
// lived in a scratchpad — meaning any later edit to the YAML could regress the
// hold with nothing failing. This file commits that harness: it extracts the
// REAL script from the workflow YAML, executes it against a mock Octokit, and
// asserts the decision matrix.

const WORKFLOW = resolve(
  __dirname,
  "..",
  ".github",
  "workflows",
  "auto-merge.yml",
);

const loadScript = (): string => {
  const doc = parse(readFileSync(WORKFLOW, "utf8"));
  const steps: Array<{ uses?: string; with?: { script?: string } }> =
    doc.jobs.automerge.steps;
  const step = steps.find(
    (s) => s.uses?.startsWith("actions/github-script") && s.with?.script,
  );
  if (!step?.with?.script) throw new Error("github-script step not found");
  return step.with.script;
};

type Pr = {
  number: number;
  state: string;
  draft: boolean;
  body: string;
  node_id: string;
  head: { ref: string; sha: string; repo: { full_name: string } };
  // What the pulls.get payload carries. The hold must NOT read this — it must
  // do a fresh listLabelsOnIssue at the point of decision (a label applied
  // while CI ran would otherwise be invisible to the very run that merges).
  labels: Array<{ name: string }>;
};

const makePr = (over: Partial<Pr> & { number: number }): Pr => ({
  state: "open",
  draft: true,
  body: "Normal PR body.",
  node_id: `node-${over.number}`,
  head: {
    ref: "claude/some-branch",
    sha: `sha-${over.number}`,
    repo: { full_name: "o/r" },
  },
  labels: [],
  ...over,
});

type Outcome = { undrafted: number[]; merged: number[]; warnings: string[] };

// Runs the real workflow script against one PR and records what it did.
const run = async (
  pr: Pr,
  opts: {
    // Labels returned by the FRESH listLabelsOnIssue read (not pr.labels).
    freshLabels?: Array<{ name: string }> | (() => never);
    ciGreen?: boolean;
  } = {},
): Promise<Outcome> => {
  const out: Outcome = { undrafted: [], merged: [], warnings: [] };
  const ciGreen = opts.ciGreen !== false;
  const github = {
    rest: {
      pulls: {
        list: async () => ({ data: [pr] }),
        get: async () => ({ data: pr }),
        merge: async ({ pull_number }: { pull_number: number }) => {
          out.merged.push(pull_number);
          return {};
        },
      },
      repos: {
        getCombinedStatusForRef: async () => ({
          data: { total_count: 0, state: "success" },
        }),
      },
      checks: {
        listForRef: async () => ({
          data: {
            check_runs: [
              {
                name: "build-and-test",
                status: "completed",
                conclusion: ciGreen ? "success" : "failure",
              },
            ],
          },
        }),
      },
      issues: {
        listLabelsOnIssue: async () => {
          const fresh = opts.freshLabels ?? pr.labels;
          if (typeof fresh === "function") return fresh();
          return { data: fresh };
        },
      },
    },
    graphql: async (_q: string, { id }: { id: string }) => {
      const n = Number(id.replace("node-", ""));
      out.undrafted.push(n);
      pr.draft = false;
      return {};
    },
  };
  const core = {
    info: () => {},
    warning: (msg: string) => out.warnings.push(msg),
  };
  const context = { repo: { owner: "o", repo: "r" } };
  const script = loadScript();
  // Same shape github-script uses: the script body runs with github/context/core
  // in scope, awaited.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function(
    "github",
    "context",
    "core",
    `return (async () => { ${script} })();`,
  );
  await fn(github, context, core);
  return out;
};

describe("auto-merge hold matrix", () => {
  let pr: Pr;
  beforeEach(() => {
    pr = makePr({ number: 7 });
  });

  it("merges a green, unheld claude/* PR: promotes out of draft, then squash-merges", async () => {
    const out = await run(pr);
    expect(out.undrafted).toEqual([7]);
    expect(out.merged).toEqual([7]);
  });

  it("holds on the do-not-merge label: no un-draft, no merge", async () => {
    const out = await run(pr, { freshLabels: [{ name: "do-not-merge" }] });
    expect(out.undrafted).toEqual([]);
    expect(out.merged).toEqual([]);
    expect(out.warnings.join(" ")).toContain("held");
  });

  it("sees a label applied MID-RUN — the fresh read at the point of decision, not the pulls.get payload", async () => {
    // The stale payload says unlabelled; the fresh read says held. Reading
    // pr.labels instead of listLabelsOnIssue is the mutant this kills: a
    // coach who labels the PR while CI is still running must be honored by
    // the very run that would otherwise merge.
    pr.labels = [];
    const out = await run(pr, { freshLabels: [{ name: "do-not-merge" }] });
    expect(out.merged).toEqual([]);
  });

  it("fails SAFE when the label lookup throws: treated as held, logged at warning", async () => {
    const out = await run(pr, {
      freshLabels: () => {
        const e = new Error("API rate limit exceeded") as Error & {
          status: number;
        };
        e.status = 403;
        throw e;
      },
    });
    expect(out.merged).toEqual([]);
    expect(out.warnings.join(" ")).toContain("failed label lookup");
  });

  it("holds on a bare do-not-merge line in the body, including the invisible HTML-comment form", async () => {
    for (const body of [
      "Summary.\ndo-not-merge\nMore.",
      "Summary.\n<!-- do-not-merge -->\nMore.",
      "Summary.\r\ndo-not-merge\r\nMore.", // GitHub bodies are CRLF
    ]) {
      const out = await run(makePr({ number: 8, body }));
      expect(out.merged).toEqual([]);
    }
  });

  it("does NOT hold on prose that merely mentions the marker inline", async () => {
    pr.body = "Remove the do-not-merge label before shipping.";
    const out = await run(pr);
    expect(out.merged).toEqual([7]);
  });

  it("matches the hold label case-insensitively", async () => {
    const out = await run(pr, { freshLabels: [{ name: "Do-Not-Merge" }] });
    expect(out.merged).toEqual([]);
  });

  it("still refuses to merge a held PR that is already out of draft", async () => {
    pr.draft = false;
    const out = await run(pr, { freshLabels: [{ name: "do-not-merge" }] });
    expect(out.merged).toEqual([]);
  });

  it("ignores unrelated labels", async () => {
    const out = await run(pr, {
      freshLabels: [{ name: "enhancement" }, { name: "docs" }],
    });
    expect(out.merged).toEqual([7]);
  });

  it("never merges red CI, held or not — and the hold is not even consulted", async () => {
    const out = await run(pr, { ciGreen: false });
    expect(out.undrafted).toEqual([]);
    expect(out.merged).toEqual([]);
  });

  it("skips non-claude branches and forks entirely", async () => {
    for (const head of [
      { ref: "feature/x", sha: "s", repo: { full_name: "o/r" } },
      { ref: "claude/x", sha: "s", repo: { full_name: "someone-else/r" } },
    ]) {
      const out = await run(makePr({ number: 9, head, draft: false }));
      expect(out.merged).toEqual([]);
    }
  });
});
