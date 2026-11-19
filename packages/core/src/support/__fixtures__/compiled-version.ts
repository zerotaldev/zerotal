/**
 * The entry `version.test.ts` compiles with `bun build --compile` and runs, standing in for a
 * binary built by `bun zt compile`.
 *
 * Inside a compiled binary there is no file beside a module, so anything that reads one while
 * loading crashes the binary before the app boots. This loads the whole of `@zerotal/core`, the
 * way an app's entry point does, and prints the version it reports.
 */
import "../../index.ts";
import { ZEROTAL_VERSION } from "../version.ts";

console.log(JSON.stringify({ version: ZEROTAL_VERSION }));
