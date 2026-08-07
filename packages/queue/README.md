# @zerotal/queue

> Background job queue with retries, batches, chaining, and a worker pool.

Offload slow work to background jobs. Define `Job` classes, dispatch them singly, batched, or chained, choose a driver (SQLite, Redis, or sync), and process them with the worker loop or a `WorkerPool` of Bun threads.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/queue
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { QueueProvider } from "@zerotal/queue";
```

## Usage

A job extends `Job`, serialises its state in `payload()`, restores it in a static `fromPayload()`, and does the work in `handle()`. Register it so the worker can rebuild it by class name:

```ts
import { Job, JobRegistry } from "@zerotal/queue";

export class NotifyFollowersJob extends Job {
  override readonly queue = "notifications";
  override readonly maxAttempts = 3;
  override readonly retryDelay = 5000;

  constructor(public readonly postId: number) {
    super();
  }

  payload(): Record<string, unknown> {
    return { postId: this.postId };
  }

  static fromPayload(p: Record<string, unknown>): NotifyFollowersJob {
    return new NotifyFollowersJob(p["postId"] as number);
  }

  async handle(): Promise<void> {
    /* … */
  }
}

JobRegistry.register(NotifyFollowersJob as never);
```

Dispatch via the `Queue` facade:

```ts
import { Queue } from "@zerotal/queue";

await Queue.dispatch(new NotifyFollowersJob(post.id));
```

Batch jobs and react when they all finish, or chain them to run sequentially:

```ts
import { Bus } from "@zerotal/queue";

await Bus.batch(rows.map((row) => new ImportCsvRowJob(row)))
  .then(new SendImportSummaryJob(user)) // when ALL succeed
  .catch(new NotifyAdminOfFailureJob(user)) // when ANY fail
  .dispatch();

await Bus.chain([new ValidateImportJob(id), new ProcessImportJob(id)]).dispatch();
```

In tests, swap the facade for a recorder:

```ts
import { QueueFake } from "@zerotal/queue";

QueueFake.swap();
expect(QueueFake.dispatched(NotifyFollowersJob)).toHaveLength(1);
QueueFake.restore();
```

## Exports

| Export                                                                                 | Description                                              |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `Queue`                                                                                | Facade over `QueueManager`.                              |
| `Job`, `JobRegistry`                                                                   | Base job class and the class-name registry.              |
| `QueueManager`, `queueStats`, `JobStatus`, `QueueStats`                                | Manager and stats helpers.                               |
| `Bus`, `Batch`, `PendingBatch`, `BatchRecord`, `BatchOptions`, `SerializedJob`         | Batch and chain orchestration.                           |
| `WorkerPool`, `WorkerPoolOptions`, `WorkerResult`                                      | Bun-thread worker pool for CPU-bound jobs.               |
| `QueueFake`                                                                            | In-memory test double.                                   |
| `QueueProvider`                                                                        | Service provider — register in `bootstrap/providers.ts`. |
| `QueueConfig`, `QueueConfigShape`                                                      | Config factory and its type.                             |
| `QueueDriver`, `JobRecord`, `BatchStatus`, `SqliteDriver`, `SyncDriver`, `RedisDriver` | Driver contract and built-in drivers.                    |
| `errors`                                                                               | Typed error vocabulary (re-exported).                    |

Subpath exports:

- `@zerotal/queue` — the public API above.
- `@zerotal/queue/commands` — `QueueWorkCommand`, `QueueFailedCommand`, `QueueRetryCommand`, `QueueFlushCommand`.

## Documentation

- [Queue](../../docs/queue.md)
