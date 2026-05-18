# Cronmit

Cronmit keeps a GitHub contribution streak alive with real file-changing commits. It also includes a local HTML dashboard for choosing streak settings, generating the GitHub Actions workflow, and designing a 12-week contribution graph pattern.

The rule is simple: no empty commits. The workflow writes to `streak/YYYY-MM-DD.md` and `streak/log.ndjson`, stages those files, and stops if nothing changed.

## Why

Some people use GitHub's contribution graph as a habit tracker, public accountability loop, or creative canvas. Cronmit is for that. It is transparent about what it does: scheduled commits, real audit files, no fake empty commits.

## Files

- `github_streak_dashboard.html` is the local control panel and generator.
- `.github/workflows/cronmit.yml` runs up to 10 scheduled slots per day.
- `scripts/commit.sh` creates the real streak commits.
- `cronmit-plan.json` controls art mode for a 12-week graph cycle.
- `streak/` stores the audit trail.

## Dashboard

Open `github_streak_dashboard.html` in your browser. From there you can:

- switch between 5 and 10 commits per day;
- switch between `steady` and `art` mode;
- adjust timezone and repo settings;
- paint a 12-week contribution graph;
- copy or download `cronmit.yml`, `commit.sh`, `cronmit-plan.json`, and GitHub CLI setup commands.

The dashboard does not ask for a GitHub token. It generates commands for your terminal instead.

## GitHub Setup

1. Push this repo to GitHub.
2. Open repo settings.
3. Go to `Actions` -> `General` -> `Workflow permissions`.
4. Choose `Read and write permissions`.
5. Go to `Secrets and variables` -> `Actions` -> `Variables`.
6. Add `COMMITS_PER_DAY` with `5` or `10`.
7. Add `CRONMIT_MODE` with `art` or `steady`.
8. If the repo is private, enable private contributions on your GitHub profile.
9. Run the `cronmit` workflow manually once from the Actions tab.

## Modes

`steady` mode uses `COMMITS_PER_DAY` every day.

`art` mode reads `cronmit-plan.json`. Each day still has at least 1 commit, so quiet squares are not blank days.

## Open Source Notes

Cronmit is intentionally small: static dashboard, one shell script, one workflow, one JSON plan. Contributions should preserve the core safety rule: every successful Cronmit commit must include a real tracked file change.

## Local Test

Run this from the repo root:

```bash
COMMIT_SLOT=1 COMMITS_PER_DAY=5 CRONMIT_MODE=art bash scripts/commit.sh
```

That command creates a real commit and tries to push, so only run it when the remote is ready.
