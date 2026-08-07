---
title: Shipping a framework with no build step
description: Zerotal packages publish TypeScript source, not compiled output. What that buys, what it costs, and why Bun finally makes it a reasonable trade.
date: 2026-07-31
category: Engineering
order: 3
---

# Shipping a framework with no build step

Open `node_modules/@zerotal/core/src/router/Router.ts`.

You will find the TypeScript we wrote. Not a bundle. Not a transpiled `dist/`. Not a `.d.ts` sitting beside a minified `.js` with a source map pointing at a file that was never published. The comments are there. The variable names are the ones we chose. The line numbers in your stack trace match the file you are reading.

Every Zerotal package publishes its `src` tree. There is no build step for your application, and there is none for the framework either.

That is an unusual claim, so it deserves the full argument — including the parts that cost you something.

## Why this is possible now and wasn't before

For twenty years, the compile step in a JavaScript package existed for one reason: the runtime could not execute the language you wrote. TypeScript went in, JavaScript came out, and everything downstream — the bundler, the source maps, the declaration emit, the dual ESM/CJS matrix, the `exports` map with six conditions — existed to manage that translation.

Bun executes and type-strips `.ts` natively. The translation is gone. So is its entire apparatus:

```json
{
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`main`, `types` and `exports` all point at the same file, because **the source is the types**. There is no declaration emit to keep in sync, no `.d.ts` that can drift from the implementation it claims to describe, no build matrix, no `prepublishOnly` script, no CI job whose only purpose is to turn our code into different code.

Once you remove it, you notice how much of modern JavaScript tooling exists to service a step that no longer needs to happen.

## What it buys

**Stack traces point at real code.** When something throws three layers into the framework, the frame reads `Router.ts:412` — a file you can open, with the comment explaining why that branch exists. No source-map indirection. No "go to definition" landing in a wall of generated declarations. The difference between debugging a library and debugging a black box is mostly this.

**The source is the documentation of last resort.** Every framework eventually makes you read its internals — when the docs are ambiguous, when the edge case is undocumented, when you need to know whether that method mutates. Doing that in published, commented TypeScript instead of bundled output is a materially different experience, and it is the one we optimise for. We write comments for the person who will read them at 2am, and then we ship those comments.

**There is no build to get wrong.** A published package cannot ship stale output, because there is no output. The entire class of bug where `dist/` lags `src/` by one commit — or where a `.d.ts` describes a signature that changed two releases ago — simply does not exist here.

**Boot is honest.** `bun zt serve` runs your application directly. No watch process compiling in the background, no incremental cache to invalidate when it gets confused, no first-request penalty while something warms up. What you measure is what runs.

**Patching is trivial.** Suspect a framework bug? Edit the file in `node_modules`, add a `console.log`, restart. You are editing readable source, not guessing at a minified identifier. It is the difference between an afternoon and a fork.

## What it costs

We would be selling you something if we stopped there. This trade has a bill.

**Bun is a hard requirement.** Importing `@zerotal/*` from a plain Node.js process is not supported. That is not a temporary gap we are working toward closing — it is the trade itself. Zerotal uses `Bun.serve`, `bun:sqlite`, `Bun.password`, `Bun.sql`, `Bun.escapeHTML` and native TypeScript execution throughout. A Node compatibility layer would mean giving up most of what makes the zero-config story work, so we would rather be one thing properly than two things partially.

**Your tooling reads our TypeScript.** If you type-check or bundle your application, it parses the framework's source rather than skipping past pre-built declarations. Any TypeScript-aware toolchain handles this correctly, but it is a real difference from the norm and it can show up in cold type-check times on a large project.

**No `.d.ts` for non-Bun consumers.** If you need conventional compiled output for a toolchain that cannot read TypeScript at all, Zerotal does not ship it today.

If any of those is a dealbreaker in your environment, that is a legitimate reason to choose a different framework — and we would much rather you learn it from this post than from a confusing install error.

## How we keep it honest

Publishing source means the published surface is exactly what sits in the repository. There is no build step to launder a mistake, so the checks have to be real:

- **`api-surface.md`, per package.** Every package's public API is snapshotted into a committed file. Change what a package exports and the diff appears in review — the surface moves deliberately, or it does not move.
- **A package-convention linter.** Provider location, config-factory shape, error base class, packaging fields. Every package passes clean; one new violation fails CI.
- **Three ratcheting baselines** — lint, type-casts, and test-file typing. Each may go down freely; moving one up is a deliberate, reviewed step with the reasoning in the pull request.
- **5,670 tests**, run per package so each package's own ambient declarations apply and nothing leaks between them.
- **Maturity levels in the manifest.** `stable`, `beta`, `experimental` — stated per package, so "is this safe to depend on?" has an answer you can read rather than infer.

None of that is exotic. It is simply what you need when nothing stands between your source and someone else's `node_modules`.

## The bet underneath

Zerotal is betting that a framework can be **complete without being heavy**, and that a large share of the weight in modern JavaScript tooling is accidental — pipeline, not product.

Removing the build step is the most visible expression of that bet, and the easiest to check. You do not have to take our word for any of it:

```bash
bun create zerotal my-app
cd my-app
bun dev
```

Then open a framework file in `node_modules` and read it. That is the whole demo.

- [Getting Started](/docs/getting-started) — scaffold, route, model, provider.
- [Support Policy](/docs/support-policy) — the runtime and database matrix we actually test against.
- [Package Development](/docs/package-development) — build your own package to the same conventions.
