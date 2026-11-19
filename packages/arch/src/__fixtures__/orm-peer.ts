/**
 * The entry `optionalPeers.test.ts` bundles and runs, standing in for a compiled app.
 *
 * It asks for the schema report, which is what loads `@zerotal/orm`, and prints one JSON line:
 * the report, or the error's class and message when it threw.
 */
import { schemaReport } from "../probe/topics.ts";

let schema: Record<string, unknown>;
try {
  schema = { report: await schemaReport() };
} catch (error) {
  schema = {
    threw: error instanceof Error ? error.constructor.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };
}

console.log(JSON.stringify({ schema }));
