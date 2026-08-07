/**
 * A generic middleware pipeline: sends a payload through an ordered list of
 * pipes and hands the final payload to a destination. Pipes are resolved from
 * the container when one is supplied, otherwise instantiated directly.
 */
import type { Container } from "../container/Container.ts";
import { injectRegistry } from "../container/inject.ts";
import type { Pipe, NextFn } from "./types.ts";

type PipeClass<T> = new (...args: unknown[]) => Pipe<T>;

/**
 * Generic middleware pipeline: sends a payload through an ordered list of pipe
 * classes and hands the final payload to a destination.
 *
 * Pipes are resolved from the container when `.via()` is called; otherwise each
 * is instantiated directly with `new PipeClass()`.
 *
 * @typeParam T - The payload type carried through the pipes (typically {@link HttpContext}).
 *
 * @example
 * const result = await Pipeline.send(ctx)
 *   .through([AuthMiddleware, ThrottleMiddleware])
 *   .via(container)           // optional — resolves pipes from container
 *   .then((ctx) => ctx.response);
 *
 * @example
 * // Run the chain and read the mutated payload back:
 * const finished = await Pipeline.send(ctx).through(pipes).via(container).thenReturn();
 * return finished.response;
 */
export class Pipeline<T> {
  private _payload!: T;
  private _pipes: PipeClass<T>[] = [];
  private _container: Container | undefined = undefined;

  private constructor() {}

  // ── Fluent builder ────────────────────────────────────────────────────

  /** Begin a pipeline carrying `payload` through the pipes added by `through()`. */
  static send<T>(payload: T): Pipeline<T> {
    const pipeline = new Pipeline<T>();
    pipeline._payload = payload;
    return pipeline;
  }

  /** Set the ordered list of pipe classes the payload travels through. */
  through(pipes: PipeClass<T>[]): this {
    this._pipes = pipes;
    return this;
  }

  /** Inject a container so pipes are resolved from it (supports `@inject`). */
  via(container: Container): this {
    this._container = container;
    return this;
  }

  // ── Execution ─────────────────────────────────────────────────────────

  /**
   * Execute the pipeline and pass the final payload to `destination`.
   * Returns whatever `destination` returns.
   */
  async then<R>(destination: (payload: T) => Promise<R> | R): Promise<R> {
    await this._run();
    return destination(this._payload);
  }

  /**
   * Execute the pipeline and return the final payload unchanged.
   *
   * The pipeline mutates the payload in-place: every pipe shares the one
   * `payload` (the request `HttpContext`), and the canonical `Response` is
   * written to `payload.response`. Read it back from there.
   */
  async thenReturn(): Promise<T> {
    await this._run();
    return this._payload;
  }

  // ── Internal recursive runner ─────────────────────────────────────────

  /**
   * Run the pipes as a recursive onion. Each pipe either calls `next()` to
   * descend, short-circuits, or wraps the downstream response. A pipe that
   * returns a `Response` has it mirrored onto `payload.response`; a `void`
   * return leaves that canonical slot untouched. `next()` resolves to whatever
   * `Response` (or `undefined`) the deeper pipes left there.
   */
  private async _run(): Promise<Response | undefined> {
    const pipes = this._pipes;
    // The canonical response store. All real pipelines carry the request
    // HttpContext; duck-typed so Pipeline stays payload-agnostic.
    const http = this._payload as { response?: Response } | undefined;

    const execute = async (index: number): Promise<Response | undefined> => {
      if (index === pipes.length) {
        // End of chain — surface whatever response was set on the way down.
        return http?.response;
      }

      const PipeClass = pipes[index]!;

      // Resolve from the container when it can actually satisfy this class (supports @inject
      // singleton middleware); otherwise instantiate directly. The previous
      // implementation used `try { makeSync() } catch { new PipeClass() }`, but middleware is
      // never registered in the container, so `makeSync` threw BindingNotFoundError for *every*
      // pipe on *every* request. `Error` captures a stack trace, which made exception
      // construction — not the middleware itself — a measurable share of per-request CPU
      // (~3.2 us per pipe). `_isContainerResolvable` is a couple of Map lookups.
      let pipeInstance: Pipe<T>;
      if (this._container && _isContainerResolvable(this._container, PipeClass)) {
        pipeInstance = this._container.makeSync(PipeClass as never) as Pipe<T>;
      } else {
        pipeInstance = new PipeClass();
      }

      const next: NextFn = () => execute(index + 1);

      const result = await pipeInstance.handle(this._payload, next);
      // Returning a Response is sugar for "set ctx.response"; a void return
      // leaves the canonical slot as the pipe (or a deeper one) left it.
      if (result instanceof Response && http) http.response = result;
      return http?.response;
    };

    return execute(0);
  }
}

/**
 * True when `container.makeSync(PipeClass)` would succeed — i.e. the class is registered, is
 * deferred behind a provider, or is auto-wirable via `@inject()`.
 *
 * This mirrors the resolution branches in {@link Container.makeSync} so the pipeline can pick
 * the right path without provoking (and swallowing) a `BindingNotFoundError` per pipe per
 * request. Kept deliberately conservative: anything it is unsure about falls through to
 * `new PipeClass()`, which is what the old catch-all did anyway.
 */
function _isContainerResolvable<T>(
  container: Container,
  PipeClass: new (...args: unknown[]) => Pipe<T>,
): boolean {
  if (container.bound(PipeClass)) return true;
  // Auto-wiring: @inject() records the class in injectRegistry, making it
  // resolvable without an explicit binding.
  return injectRegistry.has(PipeClass);
}
