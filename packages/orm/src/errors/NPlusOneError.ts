/**
 * Re-export of the error thrown by the N+1 query detector when a relation is
 * lazily loaded more times than the configured threshold in `mode: "throw"`.
 * Defined in `../db/NPlusOneDetector.ts`.
 */
export { NPlusOneError } from "../db/NPlusOneDetector.ts";
