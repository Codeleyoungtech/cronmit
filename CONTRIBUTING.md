# Contributing

Thanks for helping improve Cronmit.

## Project Rules

- Never add `git commit --allow-empty`.
- Every successful Cronmit commit must include a real tracked file change.
- Keep the dashboard static and token-free.
- Prefer small, readable changes over new dependencies.

## Local Checks

```bash
bash -n scripts/commit.sh
node --check /tmp/cronmit-dashboard.js
```

To check the dashboard script:

```bash
awk '/<script>/{flag=1;next}/<\/script>/{flag=0}flag' github_streak_dashboard.html > /tmp/cronmit-dashboard.js
node --check /tmp/cronmit-dashboard.js
```
