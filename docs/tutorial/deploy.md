---
title: Deploy It
description: Milestone 9 of the tutorial — rehearse a production release on your machine with deploy:production, pass its gate, and run the server and the worker in production mode.
---

# Deploy It

Milestone 9 of 9 in [Build Your First App](/docs/tutorial).

A Zerotal app is a Bun process: install, set the environment, migrate, build the
frontend, start the server, and start a worker for the queue. `bun zt deploy:<env>` runs
the release part of that and refuses to finish when something is wrong.
[Deployment](/docs/deployment) is the full guide, including proxies, Docker and a single
compiled binary. This milestone rehearses a release on your own machine, so you see
every refusal before a server does.

## See the plan

```bash
# in your project root
APP_ENV=production bun zt deploy:production --dry-run
```

```
Deploy → production
APP_ENV       production
preflight     config validators, then doctor checks
step          assets:build
step          inertia:build
step          migrate
verify        doctor checks again

Dry run — no steps executed. (The app was booted to resolve them.)
```

`production` and `staging` exist by default; `config/deploy.ts` adds more. The command
runs where the app runs, with that environment's variables. It does not reach a server
over SSH.

## Run the gate

`--check` runs only the preflight: everything that can refuse, and nothing that builds,
migrates or restarts. Rehearse with a separate database, so your development data is
not touched:

```bash
# in your project root
APP_ENV=production DATABASE_URL=./database/production.sqlite bun zt deploy:production --check
```

It refuses. Most lines are warnings, marked `!`; one is a failure, marked `✗`, and that
is enough to stop the release:

```
✗ Transport origins — app.url is http://localhost:3000 in a production environment, so allowedOrigins is a loopback address. Browsers send the public origin, which is not in the list — every credentialed action will be refused.
    fix: Set APP_URL to the public URL the site is served from.
✖ 1 check(s) failed at preflight. Nothing further has run — fix these and deploy again.
```

## The production environment

Each refusal names a variable to set. In production these are your platform's secrets,
not a committed file. For the rehearsal, put them in `.env.production`. The starter's
`.gitignore` and `.dockerignore` already keep every `.env.*` file except `.env.example` out
of the repository and the image, so this one stays on your machine:

```bash
# .env.production
APP_ENV=production
APP_URL=https://tasks.example.com
APP_SECURE=true
DATABASE_URL=./database/production.sqlite
HEALTH_KEY=rehearsal-health-key
MAIL_DRIVER=smtp
MAIL_FROM_ADDRESS=hello@tasks.example.com
SMTP_HOST=smtp.example.com
SMTP_USERNAME=apikey
SMTP_PASSWORD=not-a-real-password
```

What each one is for:

- **`APP_URL`** — the public origin. Requests that change data are checked against it.
- **`APP_SECURE`** — the starter's switch for `Strict-Transport-Security`, for a site
  served over HTTPS. The gate fetches `APP_URL` and refuses when nothing sends it.
- **`MAIL_DRIVER`** — this app sends real mail: verification links, password resets
  and the task notifications. With a real `MAIL_FROM_ADDRESS` and the driver still
  `log`, the gate refuses: every message would go to a log file.
- **`HEALTH_KEY`** — `/health` answers load balancers in production only when they
  send it.
- **`APP_KEY`** — already in `.env` from the scaffolder. Production needs a separate one,
  kept secret. Don't run `bun zt key:generate` for it here: that writes into this
  project's `.env` and replaces your development key. Print a new one instead and put
  it in your platform's secrets (or, for the rehearsal, add `APP_KEY=` with it to
  `.env.production`):

  ```bash
  # anywhere
  bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
  ```

[Environment](/docs/deployment#environment) lists the rest.

Load the file into your shell and run the gate again. This uses a POSIX shell (bash or
zsh; on Windows, Git Bash or WSL):

```bash
# in your project root
set -a; . ./.env.production; set +a
bun zt deploy:production --check
```

```
✓ 23 checks passed, 1 warning(s)
```

The warning left is that the eight migrations have not run on the new database. The
release runs them.

## Release

```bash
# in your project root, with .env.production loaded
bun zt deploy:production
```

It runs the gate, then `assets:build` and `inertia:build`, then the eight migrations
against the new database, then checks again:

```
migrate
Migrated 8 migration(s).
  0001_create_users_table                    ran
  0002_create_password_reset_tokens_table    ran
  0003_create_user_sessions_table            ran
  0004_create_passkeys_table                 ran
  0005_create_social_accounts_table          ran
  0006_create_projects_table                 ran
  0007_create_tasks_table                    ran
  0008_add_tenant_id_columns                 ran
Verify
✓ 23 checks passed
production release complete. Restart the service to pick it up.
```

It does not start or restart anything. Your process supervisor does that, after the
command exits 0.

## Run it

Two long-running processes: the server, and a worker for the queued notifications.

```bash
# in your project root, with .env.production loaded
PORT=3001 bun zt serve
```

```bash
# in your project root, with .env.production loaded, in a second terminal
bun zt worker
```

```
Starting Zerotal worker...
INFO  [QUEUE]    Polling [default, notifications] every 500ms
```

Without the worker, every task notification waits in the queue and nobody is told.
[Start the server](/docs/deployment#start-the-server) covers supervisors, and the
starter's `Dockerfile` is a starting point for a container.

## Check it

```bash
# in your project root
curl "http://localhost:3001/health?key=rehearsal-health-key"
```

```
{"status":"ok"}
```

Without `?key=` it answers 401. `curl -sI http://localhost:3001/` shows the
`Strict-Transport-Security` header. And `doctor` reads the running site from outside,
which is the one check the gate cannot make before the release is live:

```bash
# in your project root, with .env.production loaded
bun zt doctor --url=http://localhost:3001
```

```
All 23 checks passed.
```

Against a real deployment, point `--url` at the public address: it then also sees what
the proxy in front of the app adds or drops.

## The production checklist

The [production checklist](/docs/deployment#production-checklist) is what
`deploy:production` checks or does, and what it cannot. For this app:

| Checklist item       | Done by                                                   |
| -------------------- | --------------------------------------------------------- |
| `APP_ENV=production` | `.env.production`; the gate's first check                 |
| A strong `APP_KEY`   | A new random key, kept as a secret, not the dev one       |
| `APP_URL`            | `.env.production`; the gate refused without it            |
| `DATABASE_URL`       | `.env.production`                                         |
| Secure headers       | `APP_SECURE=true`                                         |
| CORS origins         | The starter's default: same origin only                   |
| Migrations           | `deploy:production`                                       |
| Frontend build       | `deploy:production`                                       |
| Server and worker    | `bun zt serve` and `bun zt worker`, under your supervisor |
| Probe the live site  | `bun zt doctor --url=…`                                   |

Back up the database before the first real release: see
[Back up the database](/docs/deployment#back-up-the-database).

## Where to go next

You have built a feature the way the rest of an app is built: a model and migration,
routes and pages, validation, a policy, background work, tests that include the
refusals, and teams. [What Ships](/docs/what-ships) lists what the framework already
does — roles, audit logs, uploads, scheduled jobs, an admin panel — so check it before
you build the next thing.
