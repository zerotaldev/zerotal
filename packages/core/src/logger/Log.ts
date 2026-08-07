import { createFacade } from "../facade/Facade.ts";

/**
 * Static facade over the container-bound {@link LogManager}.
 *
 * Every access resolves the live `log` singleton, so `Log` exposes the full
 * {@link LogManager} surface: the five level methods
 * ({@link LogManager.debug | debug}/{@link LogManager.info | info}/
 * {@link LogManager.warn | warn}/{@link LogManager.error | error}/
 * {@link LogManager.fatal | fatal}) on the default channel, plus
 * {@link LogManager.channel | channel} and
 * {@link LogManager.withContext | withContext}. Available after the application
 * has booted (the facade throws if accessed at module scope before boot).
 *
 * @category Logging
 *
 * @example
 * ```ts
 * import { Log } from "@zerotal/core/logger";
 *
 * // Level + structured context.
 * Log.info("Order placed", { orderId: 99, total: 42.5 });
 *
 * // Attach an error — its message and stack are captured onto the entry.
 * Log.error("Charge failed", { orderId: 99 }, err);
 *
 * // Contextual logging: shared fields merged into every subsequent entry.
 * const scoped = Log.withContext({ tenant: "acme" });
 * scoped.warn("Quota nearly exhausted", { pct: 92 });
 *
 * // Target a specific configured channel.
 * Log.channel("daily").info("Persisted to today's rotating file");
 * ```
 */
export const Log = createFacade("log");
