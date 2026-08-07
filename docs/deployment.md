---
title: Deployment
description: Take a Zerotal app to production — environment, migrations, assets, the server process, and a worker.
---

# Deployment

A Zerotal app is a Bun process. Deploying it means: install dependencies, set
production environment variables, run migrations, build frontend assets if you have
them, and start the server (plus a worker if you use queues or the scheduler).

## Production checklist

1. **`APP_ENV=production`** — disables dev-only behavior (N+1 warnings, verbose
   errors, auto-`synchronize`) and normalizes to the `web` runtime mode.
2. **Set a strong `APP_KEY`** — required for encryption, signed URLs, and sessions.
   Generate one with `bun zt key:generate` and store it as a secret.
3. **Point `DATABASE_URL`** at your production database.
4. **Run migrations** — never rely on auto-`synchronize` in production (it's
   hard-off there); ship migration files instead.
5. **Build frontend assets** if you use Inertia or bundled CSS/JS.
6. **Start the server**, and a **worker** if you use queues/scheduling.

## Environment

Set configuration through environment variables (not a committed `.env`). At minimum:

```ini
# environment variables (set as platform secrets, not a committed .env)
APP_ENV=production
APP_KEY=… # bun zt key:generate writes a base64 key
DATABASE_URL=postgres://user:pass@db-host:5432/app
```

`key:generate` writes a raw 32-byte base64 key into `.env`; both a raw base64 string
and a `base64:`-prefixed one are accepted. `APP_ENV` accepts deployment names like
`production` and `staging`; they all normalize to the `web` runtime mode — they
describe _where_ the app runs, not _how_. See [Configuration](/docs/config-system).

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

If your app serves a frontend, build the bundle so `public/` holds the compiled
output:

```bash
# in your project root — Inertia (React/Vue)
bun zt inertia:build --production
```

Flow builds its client runtime automatically at boot, so server-driven UIs need no
separate asset step. Bump your asset version (or hash the bundle) so clients reload
onto the new build — see [Inertia › Asset versioning](/docs/inertia/middleware#asset-versioning).

## Start the server

```bash
# in your project root
bun zt serve              # binds 0.0.0.0:3000
bun zt serve --port=8080  # custom port
```

Run this under a process supervisor (systemd, Docker, Fly.io, Railway, a PaaS, …) so
it restarts on crash. The server installs `SIGTERM`/`SIGINT` handlers and drains
gracefully on shutdown, which works cleanly with rolling deploys.

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
RUN bun zt inertia:build --production   # omit if you have no frontend bundle

ENV APP_ENV=production
EXPOSE 3000

# Run migrations then serve (use your platform's release step for migrate in real setups)
CMD bun zt migrate && bun zt serve --port=3000
```

Run the worker as a **second** container/service from the same image with the command
`bun zt worker`.

## Next steps

- [Configuration](/docs/config-system) — environment variables and config files.
- [Migrations](/docs/migrations) — schema changes shipped with each release.
- [Queue](/docs/queue) — what the worker process runs in the background.
- [Health](/docs/health) — the health endpoint to wire into your platform's checks.
