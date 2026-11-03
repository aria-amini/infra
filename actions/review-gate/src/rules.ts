// Fixed rules that run before the classifier. A hit here always means full
// review; the classifier can never lower it.
import defaults from "../policy.json" with { type: "json" };

export type Policy = {
  threshold: number;
  /** Below this Jev score a change is high severity; between this and threshold it is medium. */
  highBelow: number;
  maxChangedLines: number;
  maxChangedFiles: number;
  /** Generated files (lockfiles, snapshots) left out of the size caps. Still sensitive-checked. */
  notCountedForSize: string[];
  sensitive: string[];
};

export type ChangedFile = {
  filename: string;
  previous_filename?: string;
  additions: number;
  deletions: number;
};

/**
 * Merge a repo's `.github/review-gate.json` over the defaults. A repo can only
 * tighten the policy: add sensitive paths, lower the size caps, or raise the
 * threshold.
 */
export function mergePolicy(repo: Partial<Policy> | undefined): Policy {
  const base = defaults as Policy;
  if (!repo) return base;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const threshold = Math.min(1, Math.max(base.threshold, num(repo.threshold) ?? 0));
  return {
    threshold,
    highBelow: Math.min(threshold, Math.max(base.highBelow, num(repo.highBelow) ?? 0)),
    maxChangedLines: Math.min(base.maxChangedLines, num(repo.maxChangedLines) ?? Infinity),
    maxChangedFiles: Math.min(base.maxChangedFiles, num(repo.maxChangedFiles) ?? Infinity),
    notCountedForSize: base.notCountedForSize,
    sensitive: [
      ...base.sensitive,
      ...(Array.isArray(repo.sensitive) ? repo.sensitive.filter((p) => typeof p === "string") : []),
    ],
  };
}

/** Glob to regex: `**` crosses directories, `*` and `?` do not. Case-insensitive; `s` so `**` also spans a newline in a filename. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += ".*";
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

/** Reasons this change must get a full review, or an empty list. */
export function fixedRuleHits(files: ChangedFile[], policy: Policy): string[] {
  const reasons: string[] = [];
  const generated = policy.notCountedForSize.map(globToRegExp);
  const counted = files.filter((f) => !generated.some((re) => re.test(f.filename)));
  if (counted.length > policy.maxChangedFiles)
    reasons.push(`${counted.length} files changed (cap ${policy.maxChangedFiles})`);
  const lines = counted.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (lines > policy.maxChangedLines)
    reasons.push(`${lines} lines changed (cap ${policy.maxChangedLines})`);
  const patterns = policy.sensitive.map((p) => [p, globToRegExp(p)] as const);
  for (const f of files) {
    for (const path of [f.filename, f.previous_filename]) {
      if (!path) continue;
      const hit = patterns.find(([, re]) => re.test(path));
      if (hit) reasons.push(`${path} matches ${hit[0]}`);
    }
  }
  return reasons;
}
