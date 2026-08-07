import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/broadcasting errors. */
export class BroadcastError extends ZerotalError {
  constructor(
    message: string,
    code = "E_BROADCAST",
    status = 500,
    context?: Record<string, unknown>,
  ) {
    super(message, code, status, context);
  }
}

/** Thrown when the Broadcast facade is used before BroadcastProvider is registered. */
export class BroadcastProviderNotRegisteredError extends BroadcastError {
  constructor() {
    super("[Zerotal] BroadcastProvider not registered.", "E_BROADCAST_NOT_REGISTERED", 500);
  }
}

/** Thrown when a channel pattern is interpolated without a required parameter. */
export class MissingChannelParameterError extends BroadcastError {
  constructor(key: string) {
    super(
      `[Zerotal Broadcasting] Missing channel parameter: "${key}"`,
      "E_BROADCAST_MISSING_PARAM",
      500,
      { key },
    );
  }
}
