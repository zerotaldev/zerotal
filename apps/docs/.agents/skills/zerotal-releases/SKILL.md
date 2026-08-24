---
name: zerotal-releases
description: "Ship a Zerotal app — ordering the release steps, replacing built assets rather than merging into them, and the proxy and shell settings that fail quietly in production."
---

<!-- zerotal:arch:generated -->

# Shipping a release

## Name your own steps

`deploy:<env>` runs the steps named in `config/deploy.ts`, defaulting to build-and-migrate.
A preflight command of your own runs only if you name it, and nothing prompts you to:

```ts
// config/deploy.ts
export default {
  targets: {
    production: {
      url: "https://example.com",
      steps: ["release:check", "assets:build", "inertia:build", "migrate"],
    },
  },
};
```

Put the check first. A step that fails stops the release, and a check that runs after the
migration has missed its moment.

`deploy:<env>` runs **where the app runs**, with that environment's variables. It does not
reach another machine.

## Replace the asset directory, do not merge into it

Each build emits a fresh set of content-hashed chunks and cleans up the set it replaced. It
can only clean a directory it is run in. A release unpacked over the top of the running one
— `tar -xzf` into the app directory, `rsync` without `--delete` — merges: files in the
archive are written, files not in it are left exactly where they were. Nothing on that
machine ever runs a build, so last release's bundles stay, and they stay **publicly
fetchable at their hashed URLs**. Copy you withdrew is still readable by anyone with the
link.

```bash
rm -rf "$APP_DIR/public/assets"    # before extracting
tar -xzf release.tgz -C "$APP_DIR"

# or
rsync -a --delete public/assets/ "$HOST:$APP_DIR/public/assets/"
```

Clearing takes the running release's bundles away, so do it close to the swap, or stage into
a new directory and move it into place.

`--clean` on `assets:build` / `inertia:build` removes anything in the output directory the
build did not write. It is for output some other naming produced; it does not help a
directory nothing runs in, and it refuses `public/` itself.

## Rate limiting counts the proxy, not the visitor

Behind a proxy every request arrives from the same address, so one bucket is shared by
everybody and a single client can lock the site out. Say how many proxies are in front:

```ts
ThrottleMiddleware.with({ maxAttempts: 60, trustedProxies: 1 });
```

It defaults to zero because `X-Forwarded-For` is client-written until something trusted
overwrites it. Count the proxies you actually run — too many reads an entry the client
supplied.

## A pipe hides the exit status

```bash
bun test 2>&1 | tail -3     # the status is tail's. Always 0, however the suite went.
```

A deploy script gated that way prints `1 fail` and carries on to upload and restart. Use
`set -o pipefail`, or capture the status. `set -e` alone does not cover it — the pipeline
succeeded, as far as the shell is concerned.
