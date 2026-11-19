/**
 * The queued half of {@link importAction}.
 *
 * A synchronous import holds a WebSocket round-trip open, so a large file looks
 * like a hang and times out half-written. Handing the work to a queue turns that
 * into a job the worker chews through while the user gets on with their day.
 *
 * This module imports `@zerotal/queue` lazily and only when an app actually
 * queues an import, so it is an optional peer: an app that queues imports
 * installs it, and everyone else never loads it.
 *
 * The worker needs to be able to reconstruct the job from its payload, which
 * means registering the class where the worker can see it:
 *
 *   import { JobRegistry } from "@zerotal/queue";
 *   import { ImportRecordsJob } from "@zerotal/admin";
 *
 *   JobRegistry.register(ImportRecordsJob);
 *
 * A job carries the panel id and resource slug rather than the resource itself,
 * because a class cannot be serialised into a queue — the worker looks it up in
 * the same registry the panel built at boot.
 */
import { Panel } from "../Panel.ts";
import { importCsv } from "./transfer.ts";
import type { ImportResult } from "./transfer.ts";
import { frameworkLog } from "@zerotal/core/logger";
import { optionalPeer } from "@zerotal/core/runtime";

/** What the job needs to do its work, once it is pulled off the queue. */
export interface ImportRecordsPayload {
  panelId: string;
  slug: string;
  csv: string;
  mapping?: Record<number, string> | undefined;
}

/**
 * A queued CSV import.
 *
 * Deliberately shaped like a `@zerotal/queue` `Job` — `handle()` plus
 * `payload()` — without extending it, so `@zerotal/admin` needs no dependency
 * on the queue package. Registering it works the same either way.
 */
export class ImportRecordsJob {
  readonly queue = "default";
  readonly maxAttempts = 1; // A half-applied retry would double-import rows.

  constructor(private readonly _payload: ImportRecordsPayload) {}

  payload(): Record<string, unknown> {
    return { ...this._payload };
  }

  get className(): string {
    return "ImportRecordsJob";
  }

  async handle(): Promise<void> {
    const result = await runQueuedImport(this._payload);
    const log = frameworkLog("admin");
    if (result.failures.length > 0) {
      log.warn(`Import finished with ${result.failures.length} skipped row(s)`, {
        slug: this._payload.slug,
        created: result.created,
        failures: result.failures.slice(0, 10),
      });
    } else {
      log.info(`Imported ${result.created} record(s)`, { slug: this._payload.slug });
    }
  }
}

/**
 * Run an import described by a payload. Exported so an app can drive it from its
 * own job class without adopting {@link ImportRecordsJob}.
 */
export async function runQueuedImport(payload: ImportRecordsPayload): Promise<ImportResult> {
  const panel = Panel.get(payload.panelId) ?? Panel.default();
  const resource = panel.find(payload.slug);
  if (!resource) {
    return {
      created: 0,
      failures: [`No resource "${payload.slug}" on panel "${payload.panelId}".`],
    };
  }
  // The row cap is a guard against holding a request open; a worker has no such
  // constraint, so a queued import is allowed the whole file.
  return importCsv(resource, payload.csv, payload.mapping, { limit: Number.POSITIVE_INFINITY });
}

/**
 * Push an import onto the queue, returning false when no queue is available so
 * the caller can fall back to importing inline.
 */
export async function dispatchImport(payload: ImportRecordsPayload): Promise<boolean> {
  // `@zerotal/queue` is an optional peer, loaded only when an import is queued.
  // The app asked for a queue, so a missing package is an error that says what
  // to install, not a quiet inline import.
  const mod: { Bus?: { dispatch?: (job: unknown) => Promise<unknown> } } = await import(
    "@zerotal/queue" as string
  ).catch(optionalPeer("@zerotal/queue", { feature: "importAction({ queue: true })" }));
  try {
    if (typeof mod.Bus?.dispatch !== "function") return false;
    await mod.Bus.dispatch(new ImportRecordsJob(payload));
    return true;
  } catch {
    // No driver configured — the caller imports inline.
    return false;
  }
}
