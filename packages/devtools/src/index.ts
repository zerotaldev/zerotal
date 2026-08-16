// @zerotal/devtools — public API barrel

export { DevtoolsProvider } from "./provider/DevtoolsProvider.ts";
export type { DevtoolsPanelPlugin } from "./client/registry.ts";
export { DevtoolsInjectionMiddleware, startDevtoolsStream } from "./DevtoolsInjectionMiddleware.ts";
export type { DevtoolsInjectionOptions } from "./DevtoolsInjectionMiddleware.ts";
export { TraceStore, traceStore, _setTraceStore } from "./TraceStore.ts";
export type { TraceStoreOptions } from "./TraceStore.ts";
export { DevtoolsConfig } from "./config.ts";
export type { DevtoolsConfigShape, DevtoolsGate } from "./config.ts";
// Whether the inspector is running, for an app that wants to branch on it. The
// gate check and the settings reader beside it are plumbing for the middleware
// and the provider — an app never calls them, and exporting them only so a
// same-package test can import them is how internals become unchangeable.
export { devtoolsEnabled } from "./enabled.ts";
// Types only: both appear on shapes an app can hold (`SourceLocation` on a
// `QuerySpan`, `EditorName` in its config). The URL builders and the stack walker
// behind them are the panel's own business.
export type { EditorName, SourceLocation } from "./editor.ts";
export {
  redactBindings,
  redactValue,
  redactCacheKey,
  isSensitiveName,
  attributeBindings,
} from "./redaction.ts";
export type { RedactionOptions } from "./redaction.ts";
export { traceSink, traceChannels } from "./tracing.ts";
export type { TraceSink } from "./tracing.ts";
export type {
  RequestTrace,
  QuerySpan,
  NPlusOneWarning,
  MailEntry,
  CacheEntry,
  JobEntry,
  LogEntry,
  ExceptionInfo,
  RouteInfo,
  AuthInfo,
  TraceChannelDescriptor,
  TraceChannelEntry,
} from "./RequestTrace.ts";
