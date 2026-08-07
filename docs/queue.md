---
title: Queue
description: Offload slow work to background jobs that run outside the request cycle.
---

# Queue

Offload slow work to background jobs. Define jobs, dispatch them (singly, batched,
or chained), pick a driver, and process them with a worker loop or Bun Worker
threads.

## Getting Started

```bash
# in your project root
bun add @zerotal/queue
```

## Register the provider

Add `QueueProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { QueueProvider } from "@zerotal/queue";

const providers = [
  // …your other providers
  QueueProvider,
];

export default providers;
```

Registering the provider switches on the following (in lifecycle order):

- `onRegister` — binds `queue` (a `QueueManager`) as a singleton, selecting the
  driver from `config('queue.driver')`.
- `onBooting` — registers the internal `CallQueuedListener` job and points `Bus`
  at the manager so batching and chaining work.
- `onBooted` — registers the `queue:work`, `queue:failed`, `queue:retry`, and
  `queue:flush` commands.
- `onStarted` — starts the polling loop when running as a dedicated `worker`
  process, or spawns Bun Worker threads when `workers > 0` on the web server.
- `onStopping` — clears the poll interval, drains in-flight jobs, and terminates
  any Bun Worker threads, so nothing leaks between boots or test suites.

## Configuration

Create `config/queue.ts` using the `QueueConfig()` helper so every field stays
type-checked while defaults fill in the rest:

```typescript
// config/queue.ts
import { QueueConfig } from "@zerotal/queue";
import { env } from "zerotal";

export default QueueConfig({
  driver: env("QUEUE_DRIVER", "sqlite"),
  pollInterval: env("QUEUE_POLL_INTERVAL", 500),
  queues: ["default"],
  workers: env("QUEUE_WORKERS", 0),
  // workerBootstrap: new URL("../bootstrap/queue-worker.ts", import.meta.url).href,
});
```

| Field             | Required           | Default       | Description                                                         |
| ----------------- | ------------------ | ------------- | ------------------------------------------------------------------- |
| `driver`          | no                 | `"sqlite"`    | Queue driver: `"sqlite"`, `"redis"`, or `"sync"`.                   |
| `pollInterval`    | no                 | `500`         | Milliseconds between worker polls for new jobs.                     |
| `queues`          | no                 | `["default"]` | Queue names the worker listens on.                                  |
| `workers`         | no                 | `0`           | Number of Bun Worker threads to spawn. `0` = main-thread only.      |
| `workerBootstrap` | when `workers > 0` | —             | Absolute path or file URL to a module that imports every job class. |

> **Note** — `QueueConfig()` supplies the defaults above, so you only set the
> fields you want to change.

## Writing a job

A job is a class that extends `Job` and implements `handle()`. Constructor
arguments are the job's state — serialise them in `payload()` and restore them in
a static `fromPayload()`:

```typescript
// app/jobs/NotifyFollowersJob.ts
import { Job, JobRegistry } from "@zerotal/queue";

export class NotifyFollowersJob extends Job {
  // Route this job to a specific named queue (default: 'default')
  override readonly queue = "notifications";

  // Number of attempts before the job is marked as permanently failed (default: 3)
  override readonly maxAttempts = 3;

  // Milliseconds to wait between retries (default: 1000)
  override readonly retryDelay = 5000;

  constructor(public readonly postId: number) {
    super();
  }

  // Serialise state for storage
  payload(): Record<string, unknown> {
    return { postId: this.postId };
  }

  // Deserialise from storage — called by the worker
  static fromPayload(p: Record<string, unknown>): NotifyFollowersJob {
    return new NotifyFollowersJob(p["postId"] as number);
  }

  // The actual work
  async handle(): Promise<void> {
    const followers = await Follower.query().where("following_id", this.postId).get();
    for (const follower of followers) {
      await Mail.send(new NewPostMail(follower.email));
    }
  }
}

// Register so the worker can deserialise it by class name
JobRegistry.register(NotifyFollowersJob as never);
```

### Minimal job

A job with no constructor state needs only `handle()` plus the registration line:

```typescript
// app/jobs/PruneDeletedContentJob.ts
import { Job, JobRegistry } from "@zerotal/queue";

export class PruneDeletedContentJob extends Job {
  async handle(): Promise<void> {
    await Post.query().withTrashed().where("deleted_at", "<", cutoff).forceDelete();
  }
}

JobRegistry.register(PruneDeletedContentJob as never);
```

## Auto-registration

You don't import or wire up your jobs anywhere. Any job class placed under
`app/jobs/` is **auto-discovered at boot** — the convention loader imports each
file, which runs the `JobRegistry.register(...)` call at the bottom of it. That
registration is what lets the worker rebuild a job from its serialized payload by
class name, so `Queue.dispatch(new NotifyFollowersJob(id))` works from anywhere
with no manual import.

```text
// app/jobs/
app/jobs/
  NotifyFollowersJob.ts     ← discovered + registered automatically
  PruneDeletedContentJob.ts
  SendWeeklyDigestJob.ts
```

The discovery runs in every runtime (web, console, worker) so dispatching works
the same everywhere. The Bun Worker thread re-runs the same scan unless you point
`workerBootstrap` at an explicit barrel module. The only per-job requirement is
the `JobRegistry.register(...)` line — keep it at the bottom of each job file. See
[Conventions](/docs/conventions#jobs-appjobs).

## Dispatching jobs

```typescript
// in a controller
import { Queue } from "@zerotal/queue";

// Dispatch a job to the queue
await Queue.dispatch(new NotifyFollowersJob(post.id));

// The job's `queue` property decides which named queue it lands on
await Queue.dispatch(new SendWeeklyDigestJob());
```

The `Queue` facade resolves the `queue` container binding (a `QueueManager`). All
dispatched jobs are persisted to the queue driver; they are processed by the
worker loop, not the web request.

## Job batching

Batch a set of jobs and react when they all finish. Batching uses the
`zerotal_job_batches` table (auto-created by `SqliteDriver`).

```typescript
// in a controller
import { Bus } from "@zerotal/queue";

// Dispatch 10,000 import jobs; send a summary email when all finish.
const batch = await Bus.batch(rows.map((row) => new ImportCsvRowJob(row)))
  .name("csv-import-2024") // optional label
  .then(new SendImportSummaryJob(user)) // dispatched when ALL succeed
  .catch(new NotifyAdminOfFailureJob(user)) // dispatched when ANY fail
  .finally(new CleanupTempFilesJob(uploadId)) // always dispatched when complete
  .dispatch();
```

> **Note** — `then`, `catch`, and `finally` accept `Job | Job[]`. They are
> serialized as class name + payload and stored in the batch row, so they survive
> process restarts.

> **Warning** — Batching requires `SqliteDriver`. `SyncDriver` and `RedisDriver`
> do not implement the batch table, so `Bus.batch(...).dispatch()` throws a
> `QueueBatchingUnsupportedError` with them.

### Batch status object

`Bus.batch(...).dispatch()` resolves to a `Batch` instance:

```typescript
// after .dispatch()
batch.id; // UUID string
batch.name; // label from .name()
batch.totalJobs; // jobs dispatched
batch.pendingJobs; // jobs not yet processed
batch.failedJobs; // jobs permanently failed
batch.failedJobIds; // array of zerotal_jobs.id values
batch.finished(); // true once the batch has a finishedAt timestamp
batch.failed(); // true if any job failed
batch.progress(); // 0.0 → 1.0
```

> **Note** — The `Batch` you get back is a snapshot taken at dispatch time; it is
> not a live view. Re-fetch the batch from the driver to see updated progress.

## Job chaining

Run jobs sequentially: each job dispatches the next one only after it succeeds. If
any job fails, the rest of the chain is abandoned.

```typescript
// in a controller
import { Bus } from "@zerotal/queue";

await Bus.chain([
  new ValidateImportJob(fileId),
  new ProcessImportJob(fileId),
  new SendImportCompleteEmailJob(user),
]).dispatch();
```

The chain is stored in the payload of each job under `__chain` — no extra table is
needed, so chaining works with any driver.

## Processing jobs

### Dedicated worker process

The standard way to process jobs in production is a long-running worker process:

```bash
# in your project root
bun zt queue:work                  # process the 'default' queue
bun zt queue:work --queue=emails   # process a specific queue
bun zt queue:work --once           # process one job, then exit
```

The worker polls continuously, retries failed jobs up to `maxAttempts`, and moves
permanently-failed jobs to the `zerotal_failed_jobs` table.

### Manual processing

For development or small apps that don't need a separate process, drive
`Queue.processNext()` on an interval from a provider:

```typescript
// in AppServiceProvider.onStarted()
import { Queue } from "@zerotal/queue";

const queues = ["default", "notifications", "emails"];
setInterval(async () => {
  for (const q of queues) {
    await Queue.processNext(q).catch(console.error);
  }
}, 500);
```

### Which should I use?

- **`queue:work`** — production and anything with real volume. Failures, retries,
  and graceful shutdown are handled for you in a process you can scale separately.
- **Manual `setInterval`** — local development or tiny apps where running a second
  process isn't worth it.
- **`sync` driver** — tests and scripts where you want jobs to run inline and
  immediately rather than in the background.

### Draining on shutdown

`Queue.isShuttingDown` flips to `true` once the provider's `onStopping` hook runs
(on `SIGTERM`). The worker stops accepting new jobs, and `QueueManager.drain()`
waits for in-flight jobs to finish before the process exits.

### In the admin panel

When [`@zerotal/admin`](/docs/admin) is installed, the queue puts a **Jobs**
console in the panel — no configuration, just both providers registered. It has a
tab each for failed jobs, pending jobs, per-queue depth, and this process's
throughput counters, and it offers the same operations as the CLI commands: retry
or forget a single failed job, clear all of them, flush the pending queue. The
sidebar entry carries a failed-job count, which is the number you want to notice
without going looking for it.

Access is gated on the `queue.view` ability, checked both when the sidebar is
drawn and again on every action. To keep the queue provider but drop the console,
set `plugins: { queue: false }` in `config/admin.ts`.

The queue does not depend on the admin package to do this — it resolves the
panel's contribution surface from the container at boot and describes the console
as data. An app running the queue without the panel pulls in nothing extra.

## Queue drivers

| Driver     | Notes                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| `"sqlite"` | Jobs stored in a `zerotal_jobs` table in the app database. Default. Good for most apps.   |
| `"redis"`  | Jobs stored in Redis lists. Better throughput for high-volume apps. Requires `REDIS_URL`. |
| `"sync"`   | Jobs run immediately and synchronously in the dispatching process. Intended for tests.    |

> **Warning** — Only `"sqlite"` supports batching. Pick it if you rely on
> `Bus.batch()`.

## Bun Worker threads

Set `workers > 0` in `config/queue.ts` and the web server process runs jobs in Bun
Worker threads — genuine OS threads — so CPU-bound jobs don't stall the HTTP event
loop. The provider builds and wires the `WorkerPool` for you from config; you do
not construct it yourself.

```typescript
// config/queue.ts
import { QueueConfig } from "@zerotal/queue";

export default QueueConfig({
  workers: 4, // spawn 4 Bun Worker threads
  workerBootstrap: new URL("../bootstrap/queue-worker.ts", import.meta.url).href,
});
```

> **Note** — When `workerBootstrap` is omitted, each worker thread re-discovers
> jobs by scanning `app/jobs/*.ts`. Set `workerBootstrap` to a barrel module that
> imports every job when you want to skip the filesystem scan.

> **Warning** — `workerBootstrap` is required in practice once `workers > 0` if
> your jobs aren't all under `app/jobs/`: a worker thread can only run a job whose
> class it has registered.

On `SIGTERM` the provider drains the manager and calls `WorkerPool.terminate()`,
which stops every thread. Any in-flight or queued work is resolved with
`{ success: false }` so the driver can retry it.

## Testing

`QueueFake` swaps the `queue` binding for a fake that captures dispatched jobs
instead of running them, so you can assert on them:

```typescript
// in a test
import { QueueFake } from "@zerotal/queue";

const queue = QueueFake.install(); // replaces the 'queue' binding with a fake

await MyController.store({ http: ctx });

queue.assertDispatched(NotifyFollowersJob);
queue.assertDispatchedCount(1);

queue.restore(); // call in afterEach
```

## References

### Commands

`@zerotal/queue` ships the worker and the failed-job tools:

| Command                    | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `bun zt queue:work`        | Process jobs from the queue — run this as a daemon in production |
| `bun zt queue:work --once` | Process a single job, then exit                                  |
| `bun zt queue:failed`      | List all failed jobs                                             |
| `bun zt queue:retry <id>`  | Retry a failed job by id, or `all` to retry everything           |
| `bun zt queue:flush`       | Delete all failed jobs from the database                         |

### `Queue` facade

The facade proxies a `QueueManager` resolved from the `queue` binding.

| Method           | Signature                              | Description                                      |
| ---------------- | -------------------------------------- | ------------------------------------------------ |
| `dispatch`       | `(job: Job) => Promise<void>`          | Persist a job to its queue for later processing. |
| `processNext`    | `(queue?: string) => Promise<boolean>` | Pop and run the next job; `false` if none.       |
| `size`           | `(queue?: string) => Promise<number>`  | Count pending jobs on a queue.                   |
| `drain`          | `() => Promise<void>`                  | Stop accepting work and wait for in-flight jobs. |
| `isShuttingDown` | `boolean`                              | `true` once shutdown has begun.                  |

### `Bus`

| Method  | Signature                                        | Description                                          |
| ------- | ------------------------------------------------ | ---------------------------------------------------- |
| `batch` | `(jobs: Job[]) => PendingBatch`                  | Start a batch builder (`.then`/`.catch`/`.finally`). |
| `chain` | `(jobs: Job[]) => { dispatch(): Promise<void> }` | Run jobs sequentially, stopping on first failure.    |

### `PendingBatch`

| Method     | Signature                     | Description                                 |
| ---------- | ----------------------------- | ------------------------------------------- |
| `name`     | `(n: string) => this`         | Label the batch.                            |
| `then`     | `(job: Job \| Job[]) => this` | Dispatched when all batched jobs succeed.   |
| `catch`    | `(job: Job \| Job[]) => this` | Dispatched when any batched job fails.      |
| `finally`  | `(job: Job \| Job[]) => this` | Always dispatched once the batch completes. |
| `dispatch` | `() => Promise<Batch>`        | Persist the batch and its jobs.             |

### `Job` (extend this)

| Member        | Type                                           | Description                                    |
| ------------- | ---------------------------------------------- | ---------------------------------------------- |
| `queue`       | `string` (default `"default"`)                 | Named queue to route this job to.              |
| `maxAttempts` | `number` (default `3`)                         | Attempts before the job is permanently failed. |
| `retryDelay`  | `number` (default `1000`)                      | Milliseconds to wait between retries.          |
| `handle`      | `() => Promise<void>`                          | The work to perform. Required.                 |
| `payload`     | `() => Record<string, unknown>`                | Serialise constructor state for storage.       |
| `fromPayload` | `(p: Record<string, unknown>) => Job` (static) | Rebuild the job from its payload.              |

### `QueueFake`

| Method                    | Signature                                       | Description                            |
| ------------------------- | ----------------------------------------------- | -------------------------------------- |
| `install`                 | `() => QueueFake` (static)                      | Swap the `queue` binding for the fake. |
| `restore`                 | `() => void`                                    | Restore the original `queue` binding.  |
| `dispatched`              | `() => Job[]`                                   | All captured jobs.                     |
| `assertDispatched`        | `(JobClass, filter?: (job) => boolean) => void` | Assert a job class was dispatched.     |
| `assertNotDispatched`     | `(JobClass) => void`                            | Assert a job class was not dispatched. |
| `assertNothingDispatched` | `() => void`                                    | Assert no jobs were dispatched.        |
| `assertDispatchedCount`   | `(count: number) => void`                       | Assert the exact dispatched count.     |

### Errors

Every queue error extends `QueueError`, which extends the framework's
`ZerotalError` — so `catch (e) { if (e instanceof QueueError) … }` catches the lot
while leaving unrelated failures alone.

| Error                           | Code                           | Raised when                                                       |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `QueueError`                    | `E_QUEUE`                      | Base class — catch this to handle any queue failure.              |
| `QueueNotInitializedError`      | `E_QUEUE_NOT_INITIALIZED`      | Dispatching before `QueueProvider` is registered.                 |
| `QueueShuttingDownError`        | `E_QUEUE_SHUTTING_DOWN`        | Dispatching during a graceful shutdown — the manager is draining. |
| `QueueBatchingUnsupportedError` | `E_QUEUE_BATCHING_UNSUPPORTED` | Using batches on a driver that has no batch support.              |

```typescript
// in a controller or service
import { QueueError, QueueShuttingDownError } from "@zerotal/queue";

try {
  await ProcessPayment.dispatch({ orderId });
} catch (error) {
  // A shutdown is expected during a deploy — retry rather than alert.
  if (error instanceof QueueShuttingDownError) return retryLater(orderId);
  if (error instanceof QueueError) return reportQueueOutage(error);
  throw error;
}
```

`QueueShuttingDownError` is the one worth handling explicitly: it means the
process is draining, not that anything is broken, so the right response is to
re-dispatch on the next boot rather than to fail the request.

## Next steps

- [Scheduler](/docs/scheduler) — run recurring jobs alongside the queue worker.
- [Notifications](/docs/notifications) — a common payload for background jobs.
- [Notifications](/docs/notifications) — queue user notifications off the request path.
- [Conventions](/docs/conventions#jobs-appjobs) — how `app/jobs/` auto-registration works.
- [Testing mocking](/docs/testing/mocking) — assert dispatched jobs with `QueueFake`.
