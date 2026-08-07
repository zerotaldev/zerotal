/**
 * Chainable value wrapper for building readable sync transformation pipelines.
 *
 * Use `fluent(value)` when you have a series of sync steps that would otherwise
 * require intermediate `let` variables. For async steps, use the standalone
 * `pipeAsync` / `tapAsync` helpers.
 *
 * @example
 * const hash = fluent(rawEmail)
 *   .pipe((e) => e.trim().toLowerCase())
 *   .tap((e) => logger.info(`Registering: ${e}`))
 *   .pipe((e) => crypto.createHash('sha256').update(e).digest('hex'))
 *   .get();
 */
export class Fluent<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  /** Transform the wrapped value and return a new Fluent. */
  pipe<R>(fn: (val: T) => R): Fluent<R> {
    return new Fluent(fn(this.#value));
  }

  /** Run a side-effect and return the same Fluent unchanged. */
  tap(fn: (val: T) => void): this {
    fn(this.#value);
    return this;
  }

  /** Unwrap the final value. */
  get(): T {
    return this.#value;
  }

  /** Template-literal / string-coercion support. */
  toString(): string {
    return String(this.#value);
  }
}

/**
 * Wrap a value in a {@link Fluent} builder to start a chainable pipeline.
 *
 * @example
 * fluent(user.name).pipe(Str.slugify).get()   // 'alice-smith'
 */
export function fluent<T>(value: T): Fluent<T> {
  return new Fluent(value);
}
