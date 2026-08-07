/**
 * A no-op {@link LogChannel} that discards every entry.
 *
 * Useful for silencing logging in tests, or as a `default` channel when you
 * want logging calls to be harmless no-ops.
 *
 * @category Channels
 *
 * @example
 * ```ts
 * // config/logging.ts
 * channels: { null: { driver: "null" } }
 * ```
 */
export class NullChannel {
  async write(): Promise<void> {}
}
