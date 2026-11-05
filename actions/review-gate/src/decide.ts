import { coderabbitApproved, coderabbitBlocking, type GitHub, type PullRequest } from "./github.ts";
import { buildState, classify, isLowRisk, type JevResult } from "./jev.ts";
import { fixedRuleHits, mergePolicy } from "./rules.ts";
import { severityFromScore, type Severity } from "./severity.ts";

export type Verdict = {
  /** approved: CodeRabbit approved the head commit. low: may merge on CI alone. full: needs CodeRabbit. */
  tier: "approved" | "low" | "full";
  reasons: string[];
  /** Not set when CodeRabbit approved: the earlier label stays. */
  severity?: Severity;
  jev?: JevResult;
};

export async function decide(
  gh: GitHub,
  pr: PullRequest,
  apiKey: string | undefined,
  opts: { checkApproval: boolean } = { checkApproval: true },
): Promise<Verdict> {
  if (opts.checkApproval) {
    const reviews = await gh.reviews(pr.number);
    // Blocking first: a later changes-requested verdict on any commit outranks an earlier approval of the head.
    if (coderabbitBlocking(reviews))
      return { tier: "full", severity: "high", reasons: ["CodeRabbit requested changes or was dismissed, and has not approved since"] };
    if (coderabbitApproved(reviews, pr.head.sha))
      return { tier: "approved", reasons: ["CodeRabbit approved this commit"] };
  }

  const [files, repoPolicy] = await Promise.all([gh.files(pr.number), gh.repoPolicy(pr.base.sha)]);
  const policy = mergePolicy(repoPolicy);
  // With no files the rules have nothing to match, so they would wrongly pass.
  if (!files.length) return { tier: "full", severity: "high", reasons: ["GitHub returned no changed files"] };
  const hits = fixedRuleHits(files, policy);
  if (hits.length) return { tier: "full", severity: "high", reasons: hits };

  if (!apiKey) return { tier: "full", severity: "high", reasons: ["no TYPESAFE_API_KEY, so no classifier"] };

  // Any failure from here on fails closed to a full review.
  try {
    const state = buildState(pr.title, files, await gh.diff(pr.number));
    // Jev must see the whole diff: anything cut off could hide the risky part.
    if (state.diff_truncated !== "no")
      return { tier: "full", severity: "high", reasons: [`diff is too large for the classifier to read in full (${state.diff_truncated})`] };
    const jev = await classify(state, apiKey);
    const scores = `low_risk ${jev.lowRisk.toFixed(3)}, threshold ${policy.threshold}`;
    const severity = severityFromScore(jev.lowRisk, policy.threshold, policy.highBelow);
    return isLowRisk(jev, policy.threshold)
      ? { tier: "low", severity, reasons: [`Jev: ${scores}`], jev }
      : { tier: "full", severity, reasons: [`Jev not confident: ${scores}, high below ${policy.highBelow}`], jev };
  } catch (e) {
    return { tier: "full", severity: "high", reasons: [`classifier failed: ${e instanceof Error ? e.message : String(e)}`] };
  }
}
