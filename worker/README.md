# Cronmit API Worker

This is the optional hosted backend for Cronmit.

Normal users should not need to deploy this. The intended product experience is:

1. Cronmit hosts one official API.
2. Users open the GitHub Pages dashboard.
3. Users click `connect github`, `apply to repo`, then `run now`.

Self-hosters can deploy this Worker if they want their own OAuth app and infrastructure.

## What It Does

- Handles GitHub OAuth.
- Stores short-lived sessions in Cloudflare KV.
- Writes generated Cronmit files into the selected repo.
- Sets `COMMITS_PER_DAY` and `CRONMIT_MODE`.
- Enables workflow write permission.
- Triggers `cronmit.yml` for verification.

## GitHub OAuth App

Create a GitHub OAuth app with:

- Application name: `Cronmit`
- Homepage URL: `https://codeleyoungtech.github.io/cronmit/`
- Authorization callback URL: `https://cronmit-api.olivia-eleyoungtech-io.workers.dev/auth/github/callback`
- Device Flow: disabled

The OAuth app needs users to approve `repo workflow` scopes.

## Cloudflare Setup

```bash
cd worker
pnpm install
pnpm exec wrangler kv namespace create CRONMIT_SESSIONS
pnpm exec wrangler kv namespace create CRONMIT_SESSIONS --preview
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm exec wrangler secret put SESSION_SECRET
pnpm exec wrangler deploy
```

Then update `wrangler.toml` with your real KV IDs and `GITHUB_CLIENT_ID`.

This repository's hosted Worker is deployed at:

```text
https://cronmit-api.olivia-eleyoungtech-io.workers.dev
```

## Dashboard Setup

Host the dashboard with:

```html
<script>
  window.CRONMIT_API_BASE = "https://cronmit-api.olivia-eleyoungtech-io.workers.dev";
</script>
```

You can also paste the Worker URL into the dashboard's `Backend API URL` field. The current dashboard works without this backend too. In that mode it generates files and GitHub CLI commands instead of applying directly.
