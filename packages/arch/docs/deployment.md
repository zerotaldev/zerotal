---
title: Deployment
description: Take a Zerotal app to production — environment, migrations, assets, the server process, a reverse proxy, and a worker.
---

# Deployment

A Zerotal app is a Bun process. Deploying it means: install dependencies, set
production environment variables, run migrations, build frontend assets if you have
them, and start the server (plus a worker if you use queues or the scheduler).

If a reverse proxy sits in front of it — and in most deployments one does — read
[Behind a reverse proxy](#behind-a-reverse-proxy) before you launch. A proxied app has
one failure mode that a green test suite cannot see.

## `bun zt deploy:<env>`

One command runs the release and refuses to finish it when something is wrong:

```bash
# on the box, with that environment's variables loaded
APP_ENV=production bun zt deploy:production
```

It runs four phases, and **everything that can refuse runs before anything that
mutates** — a bad origin list stops the deploy while the old release is still
serving, rather than after the migration has run:

| Phase     | What it does                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Preflight | Checks this process really is that environment, re-runs every config validator with production semantics, then runs `zt doctor` |
| Build     | `assets:build`, and `inertia:build --production` if the app has Inertia                                                         |
| Migrate   | `migrate` — skip with `--skip-migrations`                                                                                       |
| Verify    | `zt doctor` again, now that the schema has one story                                                                            |

It exits non-zero on any failure and **does not restart your service**. That is
deliberate: systemd, your container runtime or your deploy script owns process
lifecycle, and this gives it a gate to restart behind.

```bash
bun zt deploy:production --dry-run          # print the plan, run none of it
bun zt deploy:production --skip-migrations  # release without touching the schema
bun zt deploy:production --probe=https://example.com  # real handshake at the end
```

Every environment gets its own command. `production` and `staging` exist by default;
declare more — or give one a URL and its own steps — in `config/deploy.ts`:

```ts
import { DeployConfig } from "zerotal/config";

export default DeployConfig({
  targets: {
    production: { url: "https://example.com" },
    staging: { url: "https://staging.example.com" },
  },
});
```

The target name is checked against the deployment this process was started as, so
`deploy:production` on a staging box stops on the first line instead of migrating
the wrong database.

Each entry is a `DeployTarget`:

| Field   | Meaning                                                                                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`   | The public URL in this environment. What `--probe` handshakes against when given no URL of its own.                                                                                                                                      |
| `steps` | Override the release steps. Defaults to `DEFAULT_DEPLOY_STEPS` — `assets:build`, `inertia:build`, `migrate`. Each names a `zt` command, and one that is not registered is skipped, so an app without Inertia simply has no Inertia step. |

Omit the file entirely and you get `DEFAULT_DEPLOY_TARGETS`: `production` and
`staging`, both with the default steps.

> **Note** — `deploy:<env>` runs **where the app runs**, with that environment's
> variables. It does not reach another machine over SSH. Run it on the box, or in
> the container build, as the step before the restart.

## Production checklist

The command above automates most of this. The list is what it runs, and what it
cannot do for you.

1. **`APP_ENV=production`** — disables dev-only behavior (N+1 warnings, verbose
   errors, auto-`synchronize`) and normalizes to the `web` runtime mode.
   `staging` counts as production for all of it.
2. **Set a strong `APP_KEY`** — required for encryption, signed URLs, and sessions.
   Generate one with `bun zt key:generate` and store it as a secret.
3. **Set `APP_URL` to the public URL** — the origin browsers actually reach the app on.
   Endpoints that bypass the middleware pipeline are checked against it.
4. **Point `DATABASE_URL`** at your production database.
5. **Set `app.secureHeaders.secure: true`** once you serve over HTTPS, or no
   `Strict-Transport-Security` header is sent at all.
6. **Name your CORS origins** — `app.cors.origin: "*"` lets any site read this app's
   responses out of a visitor's browser.
7. **Run migrations** — never rely on auto-`synchronize` in production (it's
   hard-off there); ship migration files instead.
8. **Build frontend assets** as a release step, not at boot.
9. **Start the server**, and a **worker** if you use queues/scheduling.
10. **Run `bun zt doctor --url=…`** against the deployed site once it is live — the
    one check that cannot run before the cutover.

Items 1–8 are what `deploy:<env>` checks or does. Starting the process and probing
the live site are yours.

### What `--url` sees that nothing else can

`bun zt doctor` on its own reads the app from the inside, where the app is right about
itself. `--url` fetches the deployed site back through whatever proxy is in front of it,
and reports two things only that round trip can show:

- **The WebSocket transport**, handshaked as a browser would. A proxy that gates or never
  forwards the upgrade leaves the app healthy from the inside — the HTML renders, the logs
  are quiet — while every action in the browser silently does nothing.
- **Security headers sent twice.** A header the app sets and the proxy also sets is
  invisible from inside the process. `X-Frame-Options: DENY` from the proxy plus
  `SAMEORIGIN` from the app is a real deployment this found, and browsers do not agree on
  which one applies — a control enforced inconsistently, which is worse than one that is
  simply missing, because it looks configured. Conflicting values fail; identical
  duplicates warn.

The fix for a duplicate is always the same shape: pick one place — `app.secureHeaders` in
`config/app.ts`, or the proxy — and remove the other.

## Environment

Set configuration through environment variables (not a committed `.env`). At minimum:

```ini
# environment variables (set as platform secrets, not a committed .env)
APP_ENV=production
APP_URL=https://your.app
APP_KEY=… # bun zt key:generate writes a base64 key
DATABASE_URL=postgres://user:pass@db-host:5432/app
```

`key:generate` writes a raw 32-byte base64 key into `.env`; both a raw base64 string
and a `base64:`-prefixed one are accepted. Generate it **on the server** — a key carried
from a laptop is a key that has been in a shell history and a scrollback buffer.

`APP_ENV` accepts deployment names like `production` and `staging`; they all normalize to
the `web` runtime mode — they describe _where_ the app runs, not _how_. See
[Configuration](/docs/config-system).

> **Danger** — store `APP_KEY` as a managed secret, never in a committed file. Losing or rotating it invalidates encrypted values, signed URLs, and active sessions.

## Run migrations

Run pending migrations as part of each release, before the new server starts taking
traffic:

```bash
# in your project root
bun zt migrate
```

Auto-`synchronize` is **hard-off in production** — generate and commit
[migrations](/docs/migrations) during development and run them on deploy.

## Build assets

Build the frontend bundle as a release step, so `public/` holds compiled output before
the process starts:

```bash
# in your project root
bun zt assets:build              # every bundle this app declares
bun zt inertia:build --production # Inertia (React/Vue) instead
```

`assets:build` covers both sources of bundles: the entrypoints named in `app.assets`, and
Flow's conventional `resources/css/app.css` and `resources/js/app.js`.

Outside production, `serve` builds these at boot so there is nothing to remember in
development. In production it builds them only if the output directory is writable — so a
release that built its assets ahead of time and locked the tree down serves what it
shipped, and logs one line saying so. That is what lets the service run under a properly
hardened unit; see [Hardening the service](#hardening-the-service).

Bump your asset version (or hash the bundle) so clients reload onto the new build — see
[Inertia › Asset versioning](/docs/inertia/middleware#asset-versioning).

## Start the server

```bash
# in your project root
bun zt serve              # binds 0.0.0.0:3000
bun zt serve --port=8080  # custom port
```

Run this under a process supervisor (systemd, Docker, Fly.io, Railway, a PaaS, …) so
it restarts on crash. The server installs `SIGTERM`/`SIGINT` handlers and drains
gracefully on shutdown, which works cleanly with rolling deploys.

Set the port explicitly on a host that already runs something. The default is 3000, which
is also what the last app you deployed is using.

### Worker process

If you use [queues](/docs/queue) or the [scheduler](/docs/scheduler), run a separate
worker process so background work is isolated from request handling and can be scaled
independently:

```bash
# in your project root
bun zt worker
```

This boots in the `worker` environment (no HTTP server) and drains in-flight jobs on
shutdown. For small deployments you can instead poll inline from a provider's
`onStarted()` — see [Scheduler › Running the worker](/docs/scheduler#running-the-worker) —
but a dedicated process is recommended for production.

## Behind a reverse proxy

Proxying introduces one failure that nothing in your development loop can reproduce, so
it is worth understanding rather than just copying the config below.

### Why a proxied app needs `APP_URL`

Two kinds of request bypass the middleware pipeline and therefore carry their own origin
check: **WebSocket upgrades**, and **raw routes** — of which Flow's `/__flow/http` action
fallback is one. Both are credentialed and neither is protected by
[CSRF middleware](/docs/csrf), so each compares the browser's `Origin` header against the
origins the app accepts.

The app's own origin is always accepted — but "own" means the origin of the request URL,
which behind a proxy is the loopback address it bound to (`http://127.0.0.1:3002`), never
the public URL the browser sends. So the public origin has to come from config, and it
does: `AppConfig()` fills `app.allowedOrigins` from `url`.

```ts fragment
// config/app.ts
export default AppConfig({
  name: "My App",
  url: env("APP_URL", "http://localhost:3000"), // ← allowedOrigins derives from this
});
```

Name additional origins only when a genuinely different host drives the app — an SPA on
`app.example.com` calling `api.example.com`. What you pass is added to the URL's origin
rather than replacing it:

```ts fragment
// config/app.ts
export default AppConfig({
  url: env("APP_URL"),
  allowedOrigins: ["https://admin.example.com"],
});
```

Origins are compared exactly: no wildcards and no suffix matching, because
`endsWith(".example.com")` also matches `evil-example.com`.

> **Warning** — an app with the wrong origin configured renders every page correctly and refuses every action. There is no 500, nothing in the logs, and a status-code health check passes. The only symptom is that buttons do nothing.

### Never gate the transport path

**Browsers do not attach basic-auth credentials to a WebSocket handshake.** An HTTP auth
gate over a whole site — a pre-launch gate, an internal tool — therefore gates the
transport, and the app degrades to slow HTTP fallback or stops working entirely.

Exempt the transport path:

```caddyfile
# Caddyfile
your.app {
    encode zstd gzip

    @gated not path /__flow/*     # browsers don't send basic-auth on a WS handshake
    basic_auth @gated {
        staging $2b$12$…
    }

    reverse_proxy 127.0.0.1:3002 {
        flush_interval -1         # long-lived socket: don't buffer or reap it
    }
}
```

Be honest in your own config about the trade-off: action frames are then reachable without
the gate password. That is usually fine — a staging gate keeps a site out of search results
and away from passers-by, while your app's own login is what protects data, and that still
applies to every action arriving this way. But it is a decision, and the next person should
find it written down.

On a host that already serves other sites, append to the config rather than overwriting it,
validate, then reload — a syntax error takes down every app on the box:

```bash
# on the server
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

### Hardening the service

```ini
# /etc/systemd/system/your-app.service
[Service]
User=app
WorkingDirectory=/opt/app
ExecStart=/opt/app/.bun/bin/bun zt serve --port=3002
Restart=always

NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
ReadWritePaths=/opt/app/database /opt/app/storage
```

Grant write access to the directories the app genuinely writes — its database and its
storage disk. Source, `node_modules` and `.env` have no business being writable by the
running process. With assets built at deploy time, `public/` does not need to be writable
either; if you would rather let the app build at boot, add it to `ReadWritePaths`.

Give each app its own copy of Bun under its own directory. A Bun installed as root at
`/usr/local/bin/bun` is usually a symlink into `/root/.bun/`, which a service user cannot
traverse — the error is `Permission denied`, not `not found` — and a runtime upgrade for
one app should not be able to break another.

## Verifying a deploy

`bun zt doctor` runs every static check against a release: `APP_KEY` strength, the
transport origins, whether the schema has one source of truth, providers that were
configured but never registered.

```bash
# in your project root, on the server
bun zt doctor
```

Static checks run inside the process, and the expensive proxy failures are exactly the
ones that cannot be seen from there. `--url` probes the deployed app from the outside,
through the real proxy, with a real handshake and a real `Origin`:

```bash
# in your project root
bun zt doctor --url=https://your.app
```

It reports each registered WebSocket path, and reads the status the server actually
returned: `101` means a browser can open the socket; `403` is the origin guard; `401` is an
auth gate over the transport; `404` usually means the proxy is not forwarding the path.

To check it by hand, pass `--http1.1`. curl over TLS negotiates HTTP/2, where
`Connection: Upgrade` is meaningless, and you get a `404` that reads exactly like a broken
route on a server that is working perfectly:

```bash
curl -s -o /dev/null -w '%{http_code}\n' --http1.1 \
     -H 'Origin: https://your.app' -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
     -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
     https://your.app/__flow/ws          # expect 101
```

Note that a plain `curl` against an action endpoint proves less than it appears to: a
request with **no** `Origin` header is deliberately allowed through, because native and CLI
clients do not send one. The check only bites when an origin is declared — which is what a
browser always does, and what `--url` reproduces.

### Pre-launch checklist

Everything here is something that can pass a green test suite and still break in
production.

- `APP_URL` is the public URL, and `bun zt doctor` reports it under Transport origins
- `bun zt doctor --url=…` returns `101` for every transport path
- The transport path is exempt from any proxy-level auth gate
- A **browser** — not curl — has clicked a real action against the deployed site
- The service survives `systemctl restart` and comes back listening
- The app's port doesn't collide with anything already on the host
- The service user can execute its own Bun binary
- `APP_KEY` was generated on the server, not carried from a laptop
- No development database was copied to the server
- Backups actually exit `0` — run the unit once and check

## Compile to a single binary

Bun can compile the app — runtime, dependencies, and your code — into one
self-contained executable, so the deploy artifact needs no `bun install` or
`node_modules`:

```bash
# in your project root
bun zt compile --outfile=zerotal-app
./zerotal-app serve --port=3000
```

This produces a portable binary ideal for slim containers and edge hosts. Ship your
`config/`, migrations, and built `public/` assets alongside it, and provide the same
environment variables at runtime.

## A minimal Dockerfile

```dockerfile
# Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install deps first for better layer caching
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source
COPY . .
RUN bun zt assets:build   # omit if you have no frontend bundle

ENV APP_ENV=production
EXPOSE 3000

# Run migrations then serve (use your platform's release step for migrate in real setups)
CMD bun zt migrate && bun zt serve --port=3000
```

Run the worker as a **second** container/service from the same image with the command
`bun zt worker`.

On a server with no Node installed, `bun install` can fail on a transitive package whose
`postinstall` shells out to `node`. `--ignore-scripts` resolves it, but check what you are
skipping first:

```bash
# every package with an install script, before you skip them all
for p in node_modules/*/package.json node_modules/@*/*/package.json; do
  grep -l '"\(post\|pre\)\?install":' "$p"
done
```

## Next steps

- [Configuration](/docs/config-system) — environment variables and config files.
- [Migrations](/docs/migrations) — schema changes shipped with each release.
- [Queue](/docs/queue) — what the worker process runs in the background.
- [Health](/docs/health) — the health endpoint to wire into your platform's checks.
