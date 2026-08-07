---
title: Browser Tests
description: Drive a real browser against a running Zerotal app with Playwright to test Flow and Inertia UIs end-to-end.
---

# Browser Tests

Browser tests exercise the parts of your app that only exist in a real browser, by
driving a live server with Playwright and asserting on what the user sees.

Some behavior only exists in a real browser — [Flow](/docs/flow)'s WebSocket
bridge and Alpine runtime, [Inertia](/docs/inertia) client navigation, focus and
keyboard handling. Zerotal has no bespoke browser driver; you test these end-to-end
with **[Playwright](https://playwright.dev)** pointed at a running server.

> **Note** — Unit and [HTTP tests](/docs/testing/http) run on Bun's test runner. Browser tests
> run under Playwright's own runner (`*.e2e.ts` / `*.spec.ts`), separately from
> `bun test`.

## Setup

Install Playwright in your app:

```bash
# in your project root
bun add -d @playwright/test
bunx playwright install --with-deps
```

Add a `playwright.config.ts` that boots your app with the `webServer` option, so the
server starts once for the whole run and is torn down after:

```typescript
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  use: { baseURL: BASE_URL, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  // Boot the server once for the run (no --hot, to avoid reload flakiness)
  webServer: {
    command: "bun run start",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

Wire up scripts in `package.json`:

```json
// package.json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

## Writing a test

Specs live in `e2e/` and use Playwright's `test`/`expect`. Drive the page through
roles and assert on what the user sees:

```typescript
// e2e/navigate.e2e.ts
import { test, expect } from "@playwright/test";

test.describe("SPA navigation", () => {
  test("swaps content without a full page reload", async ({ page }) => {
    await page.goto("/pulse/counter");
    // A full reload would clear this marker; an SPA swap keeps it.
    await page.evaluate(() => ((window as any).__spa = true));

    await page.getByRole("link", { name: "Components" }).click();
    await expect(page).toHaveURL(/\/pulse\/components/);
    await expect(page.getByRole("heading", { name: "Native Components" })).toBeVisible();

    const kept = await page.evaluate(() => (window as any).__spa);
    expect(kept).toBe(true); // no full reload happened
  });
});
```

```bash
# in your project root
bun run test:e2e
```

## Waiting for the client to boot

Flow pages finish wiring once Alpine has walked the DOM and fired
`alpine:initialized`. A fast click can land before that and silently no-op (a flaky,
browser-dependent failure). Wait for readiness before interacting:

```typescript
// e2e/support/gotoReady.ts
import type { Page } from "@playwright/test";

export async function gotoReady(page: Page, url: string): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__alpineReady = false;
    document.addEventListener("alpine:initialized", () => ((window as any).__alpineReady = true));
  });
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__alpineReady === true, null, {
    timeout: 10_000,
  });
}
```

Then `await gotoReady(page, "/pulse/counter")` instead of `page.goto(...)` for
interactive Flow pages.

> **Warning** — Clicking before `alpine:initialized` fires is the most common source
> of browser-test flakiness. Use `gotoReady` (or an equivalent readiness wait) on any
> page driven by Flow's Alpine runtime.

## Tips

- **Seed deterministic state.** If a flow needs data, seed it before the run (or use
  pages backed by in-memory state). Browser tests don't share the transactional
  rollback that [database tests](/docs/testing/database) use.
- **Prefer role/label selectors** (`getByRole`, `getByLabel`) over CSS — they're
  resilient to markup changes and assert accessibility.
- **Run cross-browser in CI.** The three projects above cover Chromium, Firefox, and
  WebKit; enable retries on CI to absorb transient flakiness.

## Next steps

- [HTTP Tests](/docs/testing/http) — faster tests for anything not needing a browser.
- [Database Tests](/docs/testing/database) — seed and roll back data for backed flows.
- [Flow](/docs/flow) / [Inertia](/docs/inertia) — the client runtimes these tests exercise.
- [Deployment](/docs/deployment) — `bun run start`, the command the `webServer` boots.
