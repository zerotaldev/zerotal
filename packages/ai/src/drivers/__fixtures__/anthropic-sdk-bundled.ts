/**
 * The entry `AnthropicDriver.sdk.test.ts` bundles with `Bun.build` and runs, standing in for
 * a compiled app.
 *
 * Built twice: once with the SDK inlined, as `bun zt compile` embeds it for an app that has
 * it, and once with the SDK left external and run from a directory with no `node_modules`,
 * as a compiled app without it runs. Prints one line of JSON saying which way the load went.
 */
import { _loadAnthropicSdk } from "../AnthropicDriver.ts";

try {
  const sdk = await _loadAnthropicSdk();
  console.log(
    JSON.stringify({
      loaded: typeof sdk.default,
      rateLimitError: typeof sdk.default.RateLimitError,
    }),
  );
} catch (error) {
  const thrown = error as Error & { code?: string; cause?: { code?: string; missing?: unknown } };
  console.log(
    JSON.stringify({
      threw: thrown.name,
      code: thrown.code,
      cause: thrown.cause?.code,
    }),
  );
}
