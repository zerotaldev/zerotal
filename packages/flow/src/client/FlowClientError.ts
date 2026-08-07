// Client-safe base error for Flow's browser runtime.
//
// This module is bundled into the CSP-safe client runtime, so it deliberately
// extends the native `Error` rather than `@zerotal/core`'s `ZerotalError`: pulling
// the server framework into the browser bundle is exactly what the CSP-safe runtime
// must avoid. Client-side Flow errors extend this class for a consistent base.
export class FlowClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
