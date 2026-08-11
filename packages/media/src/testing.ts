/**
 * Test and advanced-wiring seams for `@zerotal/media`.
 *
 * These let a test drive the package without standing up a container: swap the
 * disk resolver, plant a config/driver pair, reset it afterwards. They are the
 * package's own internals, exposed because testing media without them is
 * genuinely awkward — not because they are part of the API.
 *
 * They live behind `@zerotal/media/testing` so the main entry point can be
 * frozen while these stay free to change:
 *
 * ```ts
 * import { setDiskResolver, resetMediaState } from "@zerotal/media/testing";
 * ```
 *
 * Nothing here is covered by the package's stability guarantee. If you find
 * yourself needing one of these in application code, that is a gap in the real
 * API worth reporting.
 */

// Shared state — the config and driver every operation reads.
export { mediaState, setMediaState, resetMediaState } from "./state.ts";
export type { MediaState } from "./state.ts";

// Disk resolution — the seam that lets tests skip building a container.
export { setDiskResolver, setDefaultDiskName, diskNameFor } from "./support/disks.ts";
export type { DiskResolver } from "./support/disks.ts";

// Conversion dispatch — swap the queue for a spy, or force the inline path.
export { setConversionDispatcher } from "./conversions/dispatch.ts";
export type { ConversionDispatcher } from "./conversions/dispatch.ts";

// Queue-bridge internals, reachable for tests that assert on job behaviour.
export { performConversions, ownerClassFor } from "./conversions/queueBridge.ts";
export { partitionConversions } from "./conversions/ConversionRunner.ts";
