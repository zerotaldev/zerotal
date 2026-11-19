/**
 * The entry `optionalPeers.test.ts` bundles and runs, standing in for a compiled app.
 *
 * It uses the three panel features that load an optional package: a record's history
 * (`@zerotal/audit`), a queued import (`@zerotal/queue`) and the database notifications provider
 * (`@zerotal/notifications`). It prints one JSON line with how each went: the error's class, code
 * and the peer it names, or what the call returned when it got past loading the package.
 */
import { dispatchImport } from "../actions/ImportRecordsJob.ts";
import { databaseNotifications } from "../databaseNotifications.ts";
import { recordHistory } from "../history.ts";

/** The parts of an error the test asserts on. */
function describeError(error: unknown): Record<string, unknown> {
  const e = error as { code?: unknown; missing?: { peer?: unknown; install?: unknown } };
  return {
    threw: error instanceof Error ? error.constructor.name : typeof error,
    code: e.code ?? null,
    peer: e.missing?.peer ?? null,
    install: e.missing?.install ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** How `run` went: what it returned, or the error it threw. */
async function outcome(run: () => unknown): Promise<Record<string, unknown>> {
  try {
    return { returned: await run() };
  } catch (error) {
    return describeError(error);
  }
}

const history = await outcome(() => recordHistory({ type: "Order", id: 1 }));
const queuedImport = await outcome(() =>
  dispatchImport({ panelId: "admin", slug: "orders", csv: "id\n1\n" }),
);
const notifications = await outcome(() =>
  databaseNotifications({ notifiable: () => ({ id: 1 }) }).resolve(),
);

console.log(JSON.stringify({ history, queuedImport, notifications }));
