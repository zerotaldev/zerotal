---
title: Console Tests
description: Run CLI commands in-process from a test and assert their output, exit code, and side effects.
---

# Console Tests

Console tests exercise your [CLI commands](/docs/commands) — generators, migrations,
maintenance tasks — without spawning a subprocess. `Artisan.call()` runs a registered
command **in-process**, captures everything it printed, and returns its exit code.

```typescript
// in a test file
import { Artisan } from "zerotal";
```

> **Note** — `Artisan.call()` needs a `CommandRunner` bound under `commands` in the
> container — present in `web` and `console` runtime modes. When you boot the app with
> [`createTestApp()`](/docs/testing/http), commands are registered for you.

## Running a command

`Artisan.call(name, parameters?)` returns `{ code, output }` — `code` is `0` on
success, and `output` is everything the command wrote via `info`/`warn`/`error`/etc.:

```typescript
// src/tests/CacheClearTest.ts
import { describe, it, expect } from "bun:test";
import { Artisan } from "zerotal";

describe("cache:clear", () => {
  it("clears the cache and reports success", async () => {
    const { code, output } = await Artisan.call("cache:clear");

    expect(code).toBe(0);
    expect(output).toContain("Cache cleared");
  });
});
```

Pass arguments and flags as a parameter map. Booleans become bare flags when `true`;
everything else becomes a `key=value` token, mirroring how the CLI parses argv:

```typescript fragment
// in a test file
await Artisan.call("migrate", { "--fresh": true });
await Artisan.call("make:model", { name: "Post", "--migration": true });
```

Output is captured, so nothing leaks to the test runner's console.

## Asserting side effects

Commands usually do work — touch the database, queue a job, write a file. Assert the
_effect_, not just the output, using the [database](/docs/testing/database) and
[mocking](/docs/testing/mocking) helpers:

```typescript fragment
// src/tests/PruneUsersTest.ts
import { Artisan } from "zerotal";
import { assertDatabaseCount, QueueFake } from "@zerotal/testing";

it("prune:users deletes stale accounts and queues a report", async () => {
  const queue = QueueFake.install();

  const { code } = await Artisan.call("prune:users", { "--days": 30 });

  expect(code).toBe(0);
  await assertDatabaseCount("users", 5);
  queue.assertDispatched(PruneReportJob);

  queue.restore();
});
```

## Unit-testing a command class

For a focused test of a single command's logic, instantiate it directly and inject a
`BufferWriter` to capture output. The `_writer`, `args`, and `flags` fields are
internal — the runner normally sets them — so a unit test reaches in with a cast:

```typescript fragment
// src/tests/GreetCommandTest.ts
import { expect } from "bun:test";
import { BufferWriter } from "zerotal";
import { GreetCommand } from "../app/commands/GreetCommand.ts";

const cmd = new GreetCommand();
const buffer = new BufferWriter();

// These are internal fields the CommandRunner usually populates:
(cmd as any)._writer = buffer; // capture output instead of printing
(cmd as any).args = { name: "Alice" };
(cmd as any).flags = {};

await cmd.run();

expect(buffer.flush()).toContain("Hello, Alice");
```

> **Tip** — Prefer `Artisan.call()` for end-to-end command behavior — it wires the
> runner for you. Reach for direct instantiation only when you deliberately want to
> bypass the runner.

## Which approach should I use?

- **`Artisan.call(name, params?)`** — the default. Use it whenever you want the real
  command behavior: argument parsing, flag defaults, container resolution, and the
  command's full `run()`. Assert on `code` and `output`, plus any side effects.
- **Direct instantiation + `BufferWriter`** — only for unit-testing one command's
  logic in isolation. You bypass the runner, so you must set `_writer`, `args`, and
  `flags` yourself.

## References

The console-testing surface lives in `@zerotal/core`:

| Member               | Signature                                                                                              | Description                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `Artisan.call`       | `call(name: string, parameters?: Record<string, string \| boolean \| number>): Promise<ArtisanResult>` | Run a registered command in-process and capture its output.      |
| `ArtisanResult`      | `{ code: number; output: string }`                                                                     | Exit code (`0` = success) and the captured output string.        |
| `BufferWriter`       | `class BufferWriter implements OutputWriter`                                                           | Capturing writer; collects output in memory instead of printing. |
| `BufferWriter.flush` | `flush(): string`                                                                                      | Return all captured output as one string and clear the buffer.   |

## Next steps

- [Commands](/docs/commands) — writing and registering commands.
- [Database](/docs/testing/database) — asserting a command's DB effects.
- [Mocking](/docs/testing/mocking) — asserting queued jobs and sent mail.
- [HTTP Tests](/docs/testing/http) — boot the app and exercise it over real requests.
