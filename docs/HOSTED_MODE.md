# Hosted Mode

Cronmit can become a one-click web app, but GitHub Pages alone is not enough.

GitHub Pages can host `github_streak_dashboard.html`. It cannot safely store a GitHub OAuth client secret, and it should not ask users to paste personal tokens into the browser.

## Target Flow

1. User opens the Cronmit dashboard on GitHub Pages.
2. User clicks `connect github`.
3. A small backend handles GitHub OAuth and returns a short-lived Cronmit session.
4. User chooses settings and clicks `apply to repo`.
5. The backend writes:
   - `.github/workflows/cronmit.yml`
   - `scripts/commit.sh`
   - `cronmit-plan.json`
6. The backend sets:
   - `COMMITS_PER_DAY`
   - `CRONMIT_MODE`
   - Actions workflow write permissions
7. User clicks `run now` to verify the workflow.

## Dashboard API Contract

Set this before loading the dashboard:

```html
<script>
  window.CRONMIT_API_BASE = "https://your-cronmit-api.example.com";
</script>
```

The dashboard expects these endpoints.

### `GET /auth/github?return_to=...`

Starts GitHub OAuth and redirects back to:

```text
{return_to}?session={short_lived_session_token}
```

### `POST /apply`

Headers:

```text
Authorization: Bearer {session}
Content-Type: application/json
```

Body:

```json
{
  "settings": {
    "owner": "Codeleyoungtech",
    "repo": "cronmit",
    "branch": "main",
    "commits_per_day": 5,
    "mode": "art",
    "timezone_offset": 1
  },
  "files": {
    ".github/workflows/cronmit.yml": "...",
    "scripts/commit.sh": "...",
    "cronmit-plan.json": "..."
  }
}
```

Backend responsibilities:

- create or update the files through the GitHub Contents API;
- preserve executable intent for `scripts/commit.sh` where possible;
- set repo variables through the Actions Variables API;
- set workflow permissions to read/write;
- return `{ "message": "Applied to owner/repo" }`.

### `POST /run`

Starts `cronmit.yml` with `commit_count=1`.

## Recommended Backend

Use a tiny Cloudflare Worker, Fly.io app, or Vercel function. Cloudflare Worker is a good fit because Cronmit needs only OAuth, a few GitHub REST calls, and no long-running process.

This repo includes a starter Worker in `worker/`.

Normal users should not need to deploy it. The intended public product is one official Cronmit API connected to the GitHub Pages dashboard. Self-hosting is only for people who want their own OAuth app, own domain, or private deployment.

Do not put a GitHub OAuth client secret inside the static dashboard.
