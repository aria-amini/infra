// Replay the gate over merged PRs and compare with what CodeRabbit actually found.
//
//   GITHUB_TOKEN=$(gh auth token) node actions/review-gate/src/backtest.ts aria-amini/dotfiles aria-amini/toolkit [--limit 30]
//
// Set TYPESAFE_API_KEY to include Jev; without it only the fixed rules run.
// "Found" means CodeRabbit left an inline comment or requested changes.
// The number that matters is "low but found": changes the gate would have
// merged without review that CodeRabbit had something to say about.
import { decide, type Verdict } from "./decide.ts";
import { GitHub, type PullRequest } from "./github.ts";

const args = process.argv.slice(2);
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args.splice(limitAt, 2)[1]) : Infinity;
const repos = args;
const token = process.env.GITHUB_TOKEN;
if (!token || !repos.length) throw new Error("usage: GITHUB_TOKEN=... backtest.ts <owner/repo>... [--limit N]");

type Row = { repo: string; pr: PullRequest; verdict: Verdict; found: boolean; reviewed: boolean };
const rows: Row[] = [];

for (const repo of repos) {
  const gh = new GitHub(token, repo);
  const pulls = (await gh.paginate<PullRequest>(`/repos/${repo}/pulls?state=closed`))
    .filter((p) => p.merged_at)
    .slice(0, limit);
  for (const pr of pulls) {
    const [verdict, reviews, comments] = await Promise.all([
      decide(gh, pr, process.env.TYPESAFE_API_KEY, { checkApproval: false }),
      gh.reviews(pr.number),
      gh.paginate<{ user: { login: string } | null; in_reply_to_id?: number }>(
        `/repos/${repo}/pulls/${pr.number}/comments`,
      ),
    ]);
    const isRabbit = (u: { login: string } | null) => u?.login === "coderabbitai[bot]";
    const found =
      comments.some((c) => isRabbit(c.user) && !c.in_reply_to_id) ||
      reviews.some((r) => isRabbit(r.user) && r.state === "CHANGES_REQUESTED");
    const reviewed = reviews.some((r) => isRabbit(r.user));
    rows.push({ repo, pr, verdict, found, reviewed });
    const mark = verdict.tier === "low" ? (found ? "LOW*" : "low ") : "full";
    console.log(
      `${mark} ${repo}#${pr.number} ${found ? "found " : reviewed ? "clean " : "unrev "} ${pr.title.slice(0, 60)}\n      ${verdict.reasons.slice(0, 3).join("; ")}`,
    );
  }
}

const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const low = (r: Row) => r.verdict.tier === "low";
console.log(`
${rows.length} PRs
  routed low:                  ${count(low)}
  routed full:                 ${count((r) => !low(r))}
  CodeRabbit found something:  ${count((r) => r.found)}
  low, reviewed, nothing:      ${count((r) => low(r) && r.reviewed && !r.found)}
  low, unreviewed (unknown):   ${count((r) => low(r) && !r.reviewed && !r.found)}   <- no evidence either way
  low but found (misses):      ${count((r) => low(r) && r.found)}   <- inspect each LOW* row
  classifier errors:           ${count((r) => r.verdict.reasons.some((x) => x.startsWith("classifier failed")))}   <- routed full without a Jev answer
  full and found (correct):    ${count((r) => !low(r) && r.found)}
  full, reviewed, nothing:     ${count((r) => !low(r) && r.reviewed && !r.found)}   <- reviews that were wasted`);
