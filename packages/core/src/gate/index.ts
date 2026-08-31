/**
 * The site gate — maintenance, and private preview.
 *
 * Published as `@zerotal/core/gate`. See {@link Gate} for the API and
 * {@link GateMiddleware} for what happens to a request while the gate is up.
 *
 * @packageDocumentation
 */
export { Gate } from "./Gate.ts";
export type { GateStatus, MaintenanceOptions, PreviewOptions } from "./Gate.ts";
export { GateMiddleware, GATE_COOKIE, GATE_QUERY } from "./GateMiddleware.ts";
export { readGate, gateExpired, GATE_FILE } from "./state.ts";
export type { GateState, GateMode } from "./state.ts";
