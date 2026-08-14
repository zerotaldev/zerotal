/**
 * Handles a set of conversions off the request path.
 *
 * @param mediaId - Row to convert.
 * @param conversions - Names of the conversions to generate.
 */
export type ConversionDispatcher = (mediaId: number, conversions: string[]) => Promise<void>;

let _dispatcher: ConversionDispatcher | null = null;

/**
 * Install the queue-backed dispatcher.
 *
 * `MediaProvider` calls this only when a `queue` binding exists, which is what
 * keeps `@zerotal/media` free of a hard dependency on `@zerotal/queue`: an app
 * that never queues never pulls the package in, and one that does gets deferred
 * conversions with no extra wiring.
 */
export function setConversionDispatcher(dispatcher: ConversionDispatcher | null): void {
  _dispatcher = dispatcher;
}

/** Whether conversions can currently be deferred. */
/** @internal — queue-bridge wiring. */
export function isQueueAvailable(): boolean {
  return _dispatcher !== null;
}

/**
 * Hand conversions to the queue.
 *
 * A no-op when nothing is installed — callers check {@link isQueueAvailable}
 * first and run inline instead, so this is only reached if a queue disappeared
 * between the check and the dispatch.
 *
 * @internal — queue-bridge wiring.
 */
export async function dispatchConversions(mediaId: number, conversions: string[]): Promise<void> {
  if (_dispatcher === null) return;
  await _dispatcher(mediaId, conversions);
}
