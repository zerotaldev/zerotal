/**
 * Background-process check-ins, published as `@zerotal/core/heartbeat`.
 *
 * See {@link Heartbeat} for why the beat lives in the cache and why "I cannot
 * tell" is a distinct answer from "nobody is running".
 *
 * @packageDocumentation
 */
export { Heartbeat } from "./Heartbeat.ts";
export type { Beat, BeatLookup } from "./Heartbeat.ts";
export { workerLivenessCheck, describeBeat } from "./doctor.ts";
