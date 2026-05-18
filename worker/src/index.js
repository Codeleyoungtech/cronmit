const GITHUB_API = "https://api.github.com";
const GITHUB_LOGIN = "https://github.com/login/oauth";
const SESSION_TTL_SECONDS = 60 * 60 * 2;
const STATE_TTL_SECONDS = 60 * 10;
const MAX_FILE_BYTES = 300_000;
const ALLOWED_FILE_PATHS = [".github/workflows/cronmit.yml", "scripts/commit.sh", "cronmit-plan.json"];

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(request, env) });
      }

      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true }, request, env);
      }

      if (request.method === "GET" && url.pathname === "/auth/github") {
        return startGithubAuth(request, env);
      }

      if (request.method === "GET" && url.pathname === "/auth/github/callback") {
        return finishGithubAuth(request, env);
      }

      if (request.method === "POST" && url.pathname === "/apply") {
        return withSession(request, env, (session) => applyCronmit(request, env, session));
      }

      if (request.method === "POST" && url.pathname === "/run") {
        return withSession(request, env, (session) => runCronmit(request, env, session));
      }

      return json({ error: "Not found" }, request, env, 404);
    } catch (error) {
      return json({ error: error.message || "Unexpected error" }, request, env, error.status || 500);
    }
  }
};

async function startGithubAuth(request, env) {
  requireEnv(env, "GITHUB_CLIENT_ID");
  requireEnv(env, "SESSION_SECRET");

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("return_to");
  if (!returnTo || !isAllowedReturnTo(returnTo, env)) {
    return json({ error: "Invalid return_to URL" }, request, env, 400);
  }

  const stateId = crypto.randomUUID();
  const statePayload = JSON.stringify({ id: stateId, return_to: returnTo, created_at: Date.now() });
  const state = await signState(statePayload, env.SESSION_SECRET);

  await env.CRONMIT_SESSIONS.put(`state:${stateId}`, "1", { expirationTtl: STATE_TTL_SECONDS });

  const authUrl = new URL(`${GITHUB_LOGIN}/authorize`);
  authUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", callbackUrl(request));
  authUrl.searchParams.set("scope", "repo workflow");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("allow_signup", "true");

  return Response.redirect(authUrl.toString(), 302);
}

async function finishGithubAuth(request, env) {
  requireEnv(env, "GITHUB_CLIENT_ID");
  requireEnv(env, "GITHUB_CLIENT_SECRET");
  requireEnv(env, "SESSION_SECRET");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw httpError(400, "Missing OAuth code or state");

  const statePayload = JSON.parse(await verifyState(state, env.SESSION_SECRET));
  const stateKey = `state:${statePayload.id}`;
  const stateExists = await env.CRONMIT_SESSIONS.get(stateKey);
  if (!stateExists) throw httpError(400, "OAuth state expired");
  await env.CRONMIT_SESSIONS.delete(stateKey);

  const tokenResponse = await fetch(`${GITHUB_LOGIN}/access_token`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(request)
    })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw httpError(401, tokenData.error_description || "GitHub token exchange failed");
  }

  const sessionId = crypto.randomUUID();
  await env.CRONMIT_SESSIONS.put(`session:${sessionId}`, JSON.stringify({
    access_token: tokenData.access_token,
    scope: tokenData.scope || "",
    created_at: Date.now()
  }), { expirationTtl: SESSION_TTL_SECONDS });

  const returnUrl = new URL(statePayload.return_to);
  returnUrl.searchParams.set("session", sessionId);
  return Response.redirect(returnUrl.toString(), 302);
}

async function applyCronmit(request, env, session) {
  const body = await readJson(request);
  const payload = validatePayload(body);
  const { owner, repo, branch, commits_per_day: commitsPerDay, mode } = payload.settings;
  const token = session.access_token;

  await assertRepoAccess(token, owner, repo);

  for (const path of ALLOWED_FILE_PATHS) {
    await upsertFile(token, owner, repo, branch, path, payload.files[path]);
  }

  await setWorkflowPermissions(token, owner, repo);
  await upsertVariable(token, owner, repo, "COMMITS_PER_DAY", String(commitsPerDay));
  await upsertVariable(token, owner, repo, "CRONMIT_MODE", mode);

  return json({ message: `Applied Cronmit to ${owner}/${repo}` }, request, env);
}

async function runCronmit(request, env, session) {
  const body = await readJson(request);
  const settings = validateSettings(body.settings || {});
  const commitCount = Number(body.commit_count || 1);
  if (!Number.isInteger(commitCount) || commitCount < 1 || commitCount > 10) {
    throw httpError(400, "commit_count must be 1-10");
  }

  await githubFetch(session.access_token, `/repos/${settings.owner}/${settings.repo}/actions/workflows/cronmit.yml/dispatches`, {
    method: "POST",
    body: {
      ref: settings.branch,
      inputs: { commit_count: String(commitCount) }
    },
    expected: [204]
  });

  return json({ message: `Started Cronmit workflow for ${settings.owner}/${settings.repo}` }, request, env);
}

async function withSession(request, env, handler) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "Missing session" }, request, env, 401);

  const raw = await env.CRONMIT_SESSIONS.get(`session:${match[1]}`);
  if (!raw) return json({ error: "Session expired" }, request, env, 401);

  return handler(JSON.parse(raw));
}

async function assertRepoAccess(token, owner, repo) {
  await githubFetch(token, `/repos/${owner}/${repo}`, { expected: [200] });
}

async function upsertFile(token, owner, repo, branch, path, content) {
  if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) {
    throw httpError(400, `${path} is too large`);
  }

  let sha;
  const existing = await githubFetch(token, `/repos/${owner}/${repo}/contents/${encodeURIComponentPath(path)}?ref=${encodeURIComponent(branch)}`, {
    expected: [200, 404]
  });
  if (existing.status === 200) sha = existing.data.sha;

  await githubFetch(token, `/repos/${owner}/${repo}/contents/${encodeURIComponentPath(path)}`, {
    method: "PUT",
    expected: [200, 201],
    body: {
      message: `chore(cronmit): update ${path}`,
      content: base64Encode(content),
      branch,
      sha
    }
  });
}

async function setWorkflowPermissions(token, owner, repo) {
  await githubFetch(token, `/repos/${owner}/${repo}/actions/permissions/workflow`, {
    method: "PUT",
    expected: [204],
    body: {
      default_workflow_permissions: "write",
      can_approve_pull_request_reviews: false
    }
  });
}

async function upsertVariable(token, owner, repo, name, value) {
  const patch = await githubFetch(token, `/repos/${owner}/${repo}/actions/variables/${name}`, {
    method: "PATCH",
    expected: [204, 404],
    body: { name, value }
  });
  if (patch.status !== 404) return;

  await githubFetch(token, `/repos/${owner}/${repo}/actions/variables`, {
    method: "POST",
    expected: [201],
    body: { name, value }
  });
}

async function githubFetch(token, path, options = {}) {
  const method = options.method || "GET";
  const expected = options.expected || [200];
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "cronmit",
      "x-github-api-version": "2022-11-28"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!expected.includes(response.status)) {
    throw httpError(response.status, data?.message || `GitHub API request failed: ${method} ${path}`);
  }

  return { status: response.status, data };
}

function validatePayload(body) {
  const settings = validateSettings(body.settings || {});
  const files = body.files || {};

  for (const path of ALLOWED_FILE_PATHS) {
    if (typeof files[path] !== "string" || !files[path].trim()) {
      throw httpError(400, `Missing file: ${path}`);
    }
  }

  return { settings, files };
}

function validateSettings(settings) {
  const owner = validateName(settings.owner, "owner");
  const repo = validateName(settings.repo, "repo");
  const branch = validateBranch(settings.branch || "main");
  const commitsPerDay = Number(settings.commits_per_day || 5);
  const mode = settings.mode === "steady" ? "steady" : "art";

  if (![5, 10].includes(commitsPerDay)) {
    throw httpError(400, "commits_per_day must be 5 or 10");
  }

  return { owner, repo, branch, commits_per_day: commitsPerDay, mode };
}

function validateName(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw httpError(400, `Invalid ${label}`);
  }
  return value;
}

function validateBranch(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_./-]+$/.test(value) || value.includes("..")) {
    throw httpError(400, "Invalid branch");
  }
  return value;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "Invalid JSON body");
  }
}

function callbackUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/auth/github/callback`;
}

function isAllowedReturnTo(returnTo, env) {
  try {
    const url = new URL(returnTo);
    return allowedOrigins(env).includes(url.origin);
  } catch {
    return false;
  }
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins(env);
  const headers = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };

  if (origin && allowed.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
  }

  return headers;
}

function json(data, request, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(request, env)
    }
  });
}

async function signState(payload, secret) {
  const encodedPayload = base64UrlEncode(payload);
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifyState(state, secret) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw httpError(400, "Invalid OAuth state");

  const expected = await hmac(encodedPayload, secret);
  if (signature !== expected) throw httpError(400, "Invalid OAuth state signature");

  return base64UrlDecode(encodedPayload);
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64Encode(value) {
  return btoa(unescape(encodeURIComponent(value)));
}

function base64UrlEncode(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeURIComponentPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function requireEnv(env, key) {
  if (!env[key]) throw httpError(500, `Missing ${key}`);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
