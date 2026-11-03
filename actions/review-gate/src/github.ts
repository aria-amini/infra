// Minimal GitHub REST client. No dependencies, so the action needs no install step.
import type { ChangedFile, Policy } from "./rules.ts";
import { LABEL_COLORS, labelFor, severityLabelChanges, type Severity } from "./severity.ts";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";

export type PullRequest = {
  number: number;
  title: string;
  merged_at: string | null;
  head: { sha: string };
  base: { sha: string };
};

export type Review = { state: string; commit_id: string; user: { login: string } | null };

export class GitHub {
  // Plain fields: Node's type stripping rejects parameter properties.
  private token: string;
  readonly repo: string;
  constructor(token: string, repo: string) {
    this.token = token;
    this.repo = repo;
  }

  private async request(path: string, accept = "application/vnd.github+json", init: RequestInit = {}) {
    const url = path.startsWith("http") ? path : `${API}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
    return res;
  }

  async json<T>(path: string): Promise<T> {
    return (await (await this.request(path)).json()) as T;
  }

  async paginate<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = `${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (next) {
      const res = await this.request(next);
      out.push(...((await res.json()) as T[]));
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
    }
    return out;
  }

  pull(n: number) {
    return this.json<PullRequest>(`/repos/${this.repo}/pulls/${n}`);
  }

  files(n: number) {
    return this.paginate<ChangedFile>(`/repos/${this.repo}/pulls/${n}/files`);
  }

  reviews(n: number) {
    return this.paginate<Review>(`/repos/${this.repo}/pulls/${n}/reviews`);
  }

  async diff(n: number): Promise<string> {
    return (await this.request(`/repos/${this.repo}/pulls/${n}`, "application/vnd.github.diff")).text();
  }

  /** Leave exactly one severity label on the PR, creating it if the repo lacks it. */
  async setSeverity(n: number, severity: Severity) {
    const current = (await this.paginate<{ name: string }>(`/repos/${this.repo}/issues/${n}/labels`)).map((l) => l.name);
    const { add, remove } = severityLabelChanges(current, severity);
    const json = { "Content-Type": "application/json" };
    for (const name of add) {
      try {
        await this.request(`/repos/${this.repo}/labels`, undefined, {
          method: "POST",
          headers: json,
          body: JSON.stringify({ name, color: LABEL_COLORS[severity], description: "Set by review-gate" }),
        });
      } catch (e) {
        if (!(e instanceof Error && e.message.startsWith("GitHub 422"))) throw e; // already exists
      }
      await this.request(`/repos/${this.repo}/issues/${n}/labels`, undefined, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ labels: [labelFor(severity)] }),
      });
    }
    for (const name of remove)
      await this.request(`/repos/${this.repo}/issues/${n}/labels/${encodeURIComponent(name)}`, undefined, { method: "DELETE" });
  }

  /** Set the commit status. Every run overwrites the same context, so the latest verdict is the only one. */
  async setStatus(sha: string, state: "success" | "failure", description: string, targetUrl?: string) {
    await this.request(`/repos/${this.repo}/statuses/${sha}`, undefined, {
      method: "POST",
      body: JSON.stringify({
        state,
        context: "review-gate",
        description: description.slice(0, 140),
        target_url: targetUrl,
      }),
    });
  }

  /** The repo's own policy additions, read from the base commit so a PR cannot loosen them. */
  async repoPolicy(baseSha: string): Promise<Partial<Policy> | undefined> {
    try {
      const res = await this.request(
        `/repos/${this.repo}/contents/.github/review-gate.json?ref=${baseSha}`,
        "application/vnd.github.raw+json",
      );
      return (await res.json()) as Partial<Policy>;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("GitHub 404")) return undefined;
      throw e;
    }
  }
}

/** CodeRabbit's verdicts in order. Plain COMMENTED reviews don't change a verdict; a dismissed approval does.
 *  Exact login: any account whose name merely starts with "coderabbitai" could otherwise approve. */
function verdicts(reviews: Review[]) {
  return reviews.filter(
    (r) =>
      r.user?.login === "coderabbitai[bot]" &&
      ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state),
  );
}

/** CodeRabbit approved this exact commit. */
export function coderabbitApproved(reviews: Review[], headSha: string): boolean {
  const latest = verdicts(reviews.filter((r) => r.commit_id === headSha)).at(-1);
  return latest?.state === "APPROVED";
}

/** CodeRabbit's latest verdict on any commit asks for changes, so a low-risk follow-up can't clear it.
 *  Dismissing a review rewrites its state in place, so a dismissed request for changes looks like a
 *  dismissed approval. Both keep blocking until CodeRabbit approves again. */
export function coderabbitBlocking(reviews: Review[]): boolean {
  const latest = verdicts(reviews).at(-1)?.state;
  return latest === "CHANGES_REQUESTED" || latest === "DISMISSED";
}
