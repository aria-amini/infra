// CI entrypoint. Posts the `review-gate` commit status on the PR head: success
// when the PR may merge without (more) CodeRabbit review. The status is what
// repos require, not the job. Runs from different events would leave separate
// check runs that GitHub keeps side by side, so an old failure would still block.
import { appendFileSync } from "node:fs";
import { decide } from "./decide.ts";
import { GitHub } from "./github.ts";

const env = (k: string) => process.env[k] || undefined;
const token = env("GITHUB_TOKEN");
const repo = env("GITHUB_REPOSITORY");
const number = Number(env("PR_NUMBER"));
if (!token || !repo || !number) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required");

const gh = new GitHub(token, repo);
const eventSha = env("HEAD_SHA");

try {
  const pr = await gh.pull(number);
  const verdict = await decide(gh, pr, env("TYPESAFE_API_KEY"));
  const pass = verdict.tier !== "full";

  const headline = {
    approved: "✅ CodeRabbit approved this commit",
    low: "✅ Low risk: merge on CI alone",
    full: "🛑 Needs a CodeRabbit review",
  }[verdict.tier];
  const summary = [`## Review gate: ${headline}`, "", ...verdict.reasons.map((r) => `- ${r}`), ""];
  if (!pass) summary.push("Comment `@coderabbitai review`. This check passes once CodeRabbit approves the head commit.");

  console.log(summary.join("\n"));
  if (env("GITHUB_STEP_SUMMARY")) appendFileSync(env("GITHUB_STEP_SUMMARY")!, summary.join("\n") + "\n");
  if (env("GITHUB_OUTPUT")) appendFileSync(env("GITHUB_OUTPUT")!, `tier=${verdict.tier}\n`);
  const runUrl = `${env("GITHUB_SERVER_URL")}/${repo}/actions/runs/${env("GITHUB_RUN_ID")}`;
  await gh.setStatus(pr.head.sha, pass ? "success" : "failure", headline.replace(/^\S+ /, ""), env("GITHUB_RUN_ID") ? runUrl : undefined);
  // The label is display only. Failing to set it must not change the verdict.
  if (verdict.severity)
    await gh.setSeverity(number, verdict.severity).catch((e) => console.warn(`Could not set the severity label: ${e instanceof Error ? e.message : e}`));
} catch (e) {
  // An error must not leave an earlier success standing on this commit.
  if (eventSha) await gh.setStatus(eventSha, "failure", "Gate error, needs a CodeRabbit review").catch(() => {});
  throw e;
}
