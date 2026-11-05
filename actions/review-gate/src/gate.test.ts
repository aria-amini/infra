import assert from "node:assert/strict";
import { test } from "node:test";
import { coderabbitApproved, coderabbitBlocking, type Review } from "./github.ts";
import { decide } from "./decide.ts";
import { buildState, isLowRisk, parseResponse } from "./jev.ts";
import { fixedRuleHits, globToRegExp, mergePolicy } from "./rules.ts";
import { severityFromScore, severityLabelChanges } from "./severity.ts";

const file = (filename: string, lines = 2) => ({ filename, additions: lines, deletions: 0 });

test("globs", () => {
  assert.ok(globToRegExp(".github/**").test(".github/workflows/ci.yml"));
  assert.ok(globToRegExp("**/run_onchange_*").test("home/.chezmoiscripts/run_onchange_install.sh"));
  assert.ok(globToRegExp("**/run_onchange_*").test("run_onchange_x.sh"));
  assert.ok(globToRegExp("**/*auth*").test("src/lib/OAuth.ts"));
  assert.ok(globToRegExp(".github/**").test(".github/workflows/x\ny.yml"));
  assert.ok(!globToRegExp("pulumi/**").test("docs/pulumi.md"));
  assert.ok(!globToRegExp("*.md").test("docs/a.md"));
});

test("sensitive paths, renames and size caps force full review", () => {
  const policy = mergePolicy(undefined);
  assert.deepEqual(fixedRuleHits([file("README.md")], policy), []);
  assert.equal(fixedRuleHits([file("pulumi/index.ts")], policy).length, 1);
  assert.equal(
    fixedRuleHits([{ ...file("docs/x.md"), previous_filename: ".github/workflows/ci.yml" }], policy).length,
    1,
  );
  assert.match(fixedRuleHits([file("a.ts", 1001)], policy)[0]!, /lines changed/);
  assert.deepEqual(fixedRuleHits([file("a.ts", 10), file("pnpm-lock.yaml", 5000)], policy), []);
  assert.match(fixedRuleHits(Array.from({ length: 26 }, (_, i) => file(`f${i}.md`)), policy)[0]!, /files/);
});

test("a repo policy can only tighten", () => {
  const p = mergePolicy({ threshold: 0.5, maxChangedLines: 9999, sensitive: ["src/billing/**"] });
  assert.equal(p.threshold, 0.8);
  assert.equal(p.maxChangedLines, 1000);
  assert.equal(p.highBelow, 0.3);
  assert.equal(mergePolicy({ highBelow: 0.1 }).highBelow, 0.3);
  assert.equal(mergePolicy({ highBelow: 0.5 }).highBelow, 0.5);
  assert.equal(mergePolicy({ highBelow: 0.99 }).highBelow, 0.8);
  assert.ok(p.sensitive.includes(".github/**") && p.sensitive.includes("src/billing/**"));
  assert.equal(mergePolicy({ threshold: 0.95, maxChangedLines: 100 }).maxChangedLines, 100);
  assert.equal(mergePolicy({ threshold: 0.95 }).threshold, 0.95);
});

test("CodeRabbit approval counts only on the head commit and only as its latest verdict", () => {
  const r = (state: string, commit_id = "head", login = "coderabbitai[bot]"): Review => ({
    state,
    commit_id,
    user: { login },
  });
  assert.ok(coderabbitApproved([r("CHANGES_REQUESTED"), r("APPROVED"), r("COMMENTED")], "head"));
  assert.ok(!coderabbitApproved([r("APPROVED", "old")], "head"));
  assert.ok(!coderabbitApproved([r("APPROVED"), r("DISMISSED")], "head"));
  assert.ok(!coderabbitApproved([r("APPROVED", "head", "aria-amini")], "head"));
  assert.ok(coderabbitBlocking([r("CHANGES_REQUESTED", "old"), r("COMMENTED")]));
  assert.ok(!coderabbitBlocking([r("CHANGES_REQUESTED", "old"), r("APPROVED")]));
  assert.ok(coderabbitBlocking([r("DISMISSED", "old")]));
  assert.ok(!coderabbitApproved([r("APPROVED", "head", "coderabbitai-imposter")], "head"));
  assert.ok(!coderabbitApproved([r("APPROVED", "head", "coderabbitai")], "head"));
});

test("Jev parsing fails closed and the threshold is inclusive", () => {
  const res = parseResponse({ model: "jev", answers: { low_risk: { type: "noul", noul: 0.8 } } });
  assert.ok(isLowRisk(res, 0.8));
  assert.ok(!isLowRisk({ ...res, lowRisk: 0.79 }, 0.8));
  assert.throws(() => parseResponse({ answers: { low_risk: { type: "noul", noul: 2 } } }));
  assert.throws(() => parseResponse({}));
});

test("long diffs are cut and the cut is stated", () => {
  const s = buildState("t", [file("a.md")], "x".repeat(60_000));
  assert.equal(s.diff.length, 48_000);
  assert.match(s.diff_truncated, /^yes/);
  assert.equal(buildState("t", [], "small").diff_truncated, "no");
});

test("severity bands and exactly one label", () => {
  assert.equal(severityFromScore(0.8, 0.8, 0.3), "low");
  assert.equal(severityFromScore(0.79, 0.8, 0.3), "medium");
  assert.equal(severityFromScore(0.3, 0.8, 0.3), "medium");
  assert.equal(severityFromScore(0.29, 0.8, 0.3), "high");
  assert.deepEqual(severityLabelChanges(["bug"], "high"), { add: ["severity:high"], remove: [] });
  assert.deepEqual(severityLabelChanges(["bug", "severity:low", "severity:high"], "medium"), {
    add: ["severity:medium"],
    remove: ["severity:low", "severity:high"],
  });
  assert.deepEqual(severityLabelChanges(["severity:low"], "low"), { add: [], remove: [] });
});

test("a later changes-requested verdict outranks an earlier approval of the head", async () => {
  const review = (state: string, commit_id: string) => ({ state, commit_id, user: { login: "coderabbitai[bot]" } });
  const run = (reviews: unknown[]) =>
    decide({ reviews: async () => reviews } as never, { number: 1, head: { sha: "head" } } as never, undefined);
  assert.equal((await run([review("APPROVED", "head"), review("CHANGES_REQUESTED", "old")])).tier, "full");
  assert.equal((await run([review("CHANGES_REQUESTED", "old"), review("APPROVED", "head")])).tier, "approved");
});
