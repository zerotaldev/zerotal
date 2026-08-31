import type { SerializedJob } from "./Batch.ts";

export abstract class Job {
  /** Queue name — override in subclass to route to specific queues */
  readonly queue: string = "default";

  /** Max retry attempts before moving to failed queue */
  readonly maxAttempts: number = 3;

  /** Milliseconds to wait between retry attempts */
  readonly retryDelay: number = 1000;

  /** Set by Bus.batch() — tracks which batch this job belongs to. */
  batchId: string | undefined = undefined;

  /** Set by Bus.chain() — remaining jobs to dispatch after this one succeeds. */
  _chain: SerializedJob[] | undefined = undefined;

  /**
   * Collapse repeated dispatches into a single run, `debounce` **seconds** after
   * the last one. Unset (the default) dispatches immediately, as before.
   *
   * This is a **trailing** debounce, and the name is accurate: each dispatch
   * pushes the run further out, and the job runs once, after the dispatches
   * stop. It is the shape the problem has — a document saved eight times in a
   * minute should rebuild its search index once, and the only rebuild anyone
   * sees is the last one. A *leading* behaviour, where the first dispatch runs
   * and the rest are dropped, is a different thing and is not this.
   *
   * **The last payload wins.** When eight dispatches collapse, the surviving
   * job carries the eighth one's data, because the whole premise is that the
   * earlier ones are stale.
   *
   * @example
   * ```ts
   * export class ReindexDocument extends Job {
   *   override readonly debounce = 30;
   *   constructor(private documentId: number) { super(); }
   *   override payload() { return { documentId: this.documentId }; }
   *   async handle() { await search.reindex(this.documentId); }
   * }
   * ```
   */
  readonly debounce?: number;

  /**
   * What counts as "the same job" for {@link debounce}.
   *
   * Defaults to the class name plus the serialised payload, so
   * `ReindexDocument(1)` and `ReindexDocument(2)` are different work and do not
   * collapse into each other — which is what makes the common case need no
   * configuration at all.
   *
   * Override when two payloads mean the same work. A job carrying a timestamp,
   * or a request id, is unique on every dispatch and would otherwise never
   * collapse with anything:
   *
   * ```ts
   * override debounceKey(): string {
   *   return `reindex:${this.documentId}`;   // ignore the requestedAt field
   * }
   * ```
   *
   * The key is stored in the queue's own backing store, so it is stable across
   * processes. A debounce that only held inside one worker would appear to work
   * in development and do nothing in production, where there is more than one.
   */
  debounceKey(): string {
    return `${this.className}:${JSON.stringify(this.payload())}`;
  }

  /** The job's work — implement this in every subclass */
  abstract handle(): Promise<void>;

  /**
   * Serialize job state to a plain object for storage.
   * Override in subclasses that have constructor arguments.
   */
  payload(): Record<string, unknown> {
    return {};
  }

  /**
   * The name this job is stored and resolved under, when it should not be the
   * class name.
   *
   * A queued job is a *persisted* reference to a class: the payload in the
   * database or in Redis carries a string, and the worker looks the class up by
   * it. So the class name is a wire identifier, not just a source symbol — and
   * renaming the class silently invalidates every job already enqueued under the
   * old name. The failure lands on the deploy rather than on the change, and a
   * test never sees it, because a test enqueues and runs in the same process.
   *
   * Declaring the name decouples the two, exactly as
   * {@link @zerotal/orm!Migration.id} does for a migration's filename:
   *
   * ```ts
   * export class SendWelcomeEmail extends Job {
   *   static override jobName = "SendWelcomeEmail"; // survives a class rename
   * }
   * ```
   *
   * It also survives a build that mangles names. `zt compile` does not minify
   * today, so this is not a live hazard — but nothing about the registry said it
   * depended on that, which is the kind of assumption worth writing down before
   * it is discovered.
   *
   * Defaults to the class name, so nothing changes for a job that does not set it.
   */
  static jobName?: string;

  /**
   * The name used as the serialization key. Matches what `JobRegistry.register()`
   * stores: {@link Job.jobName} when declared, the class name otherwise.
   */
  get className(): string {
    return (this.constructor as typeof Job).jobName ?? this.constructor.name;
  }
}
