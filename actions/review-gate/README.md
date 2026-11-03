# Review gate

One required commit status, `review-gate`, for every repo. It succeeds when a PR
may merge without a CodeRabbit review, and fails closed otherwise. The status is
required rather than the job because the gate runs on two events, and GitHub
keeps each event's check run, so a stale failure would keep blocking the PR.

1. **CodeRabbit approved the head commit** → pass. A new commit needs a new
   approval.
   If its latest verdict, on any commit, asks for changes or was dismissed, the PR
   needs full review, however low risk the next commit looks, and even if an
   earlier verdict approved the head.
2. **Fixed rules** (`policy.json`) → a hit always means full review, and the
   classifier cannot lower it. The rules are sensitive paths (CI, auth, secrets,
   chezmoi scripts, migrations, deploy and infra config, this action) and size
   caps. Lockfiles and snapshots are left out of the size caps.
3. **Jev** ([TypeSafe](https://typesafe.ai)) rates whether the diff is low risk.
   The PR passes if `low_risk` is at least `threshold`. A missing key, an API
   error, a malformed reply, or an empty file list means full review.

## Severity labels

Each run leaves one `severity:*` label on the PR, replacing the last one, so it
always shows the current verdict. Labels are display only; the `review-gate`
status is what is enforced. Other labels are never touched. When CodeRabbit has
approved the head commit the label is left as it was.

| Label | When |
|---|---|
| `severity:low` | Jev `low_risk` is at least `threshold` (0.8). The gate passes. |
| `severity:medium` | `low_risk` is between `highBelow` (0.3) and `threshold`. The gate fails. |
| `severity:high` | `low_risk` is under `highBelow`, a fixed rule hit, no diff, or the classifier failed. The gate fails. |

A repo can raise `highBelow` in `.github/review-gate.json`, never lower it.

The PR description is not sent: agents write it, so it could steer the result.
The title, file list and diff are sent, and the diff is cut at 48 KB (the cut
counts against the change).

## Use it in a repo

Copy [`.github/workflows/review-gate.yml`](../../.github/workflows/review-gate.yml),
add the `TYPESAFE_API_KEY` secret, and make `review-gate` a required check.

A repo can tighten the policy in `.github/review-gate.json`, which is read from
the base commit. It can add `sensitive` globs, lower `maxChangedLines` and
`maxChangedFiles`, or raise `threshold` and `highBelow`. It cannot loosen any of them.

```json
{ "sensitive": ["src/billing/**"], "threshold": 0.9, "highBelow": 0.5 }
```

## Calibrate

Replay the gate over merged PRs and compare with what CodeRabbit found:

```sh
GITHUB_TOKEN=$(gh auth token) TYPESAFE_API_KEY=... \
  node actions/review-gate/src/backtest.ts aria-amini/dotfiles aria-amini/dutch-oven
```

Rows marked `LOW*` are misses: the gate would have skipped review, but
CodeRabbit had something to say. Read each one before lowering `threshold`.

The gate pins a Jev version in `src/jev.ts`. Rerun this before changing it,
because scores can shift between versions.

## Known gap

`pull_request_review` runs the workflow file from the PR head, so a PR that
edits its own caller workflow could post a passing `review-gate` status from that
event. Such a PR always touches `.github/**`, and only I can merge. Close this
gap with a GitHub App if outside contributors ever get merge rights.

Fork PRs: GitHub gives `pull_request_review` runs a read-only token on forks, so a
review there cannot update the status. These repos take no fork PRs. Route review
events through a trusted workflow before accepting any.
