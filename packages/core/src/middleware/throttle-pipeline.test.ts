import { describe, it, expect, afterEach } from "bun:test";
import { Pipeline } from "../pipeline/Pipeline.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";
import { Container } from "../container/Container.ts";
import { ThrottleMiddleware } from "./ThrottleMiddleware.ts";
import { RateLimiter } from "./RateLimiter.ts";

/**
 * End-to-end regression guard for rate limiting.
 *
 * Every existing throttle test drove a single hand-built middleware instance directly
 * (`mw.handle(ctx, next)`), which is not how requests are served. `Pipeline._run` constructs a
 * pipe with `new PipeClass()` per request — middleware is never container-registered — so the
 * hit counters, which lived in an instance field, were empty on every request. The limiter
 * counted to 1 forever and allowed unlimited traffic, while the unit tests passed.
 *
 * These tests drive the real `Pipeline` with a middleware *class*, which is what a route
 * registration actually hands it.
 */

function makeCtx(): HttpContext {
  return new HttpContext(new Request("http://localhost/login"), new ScopedResolver());
}

/** Serve one request through the pipeline exactly as the router does. */
async function serve(
  pipes: (new () => { handle: never })[],
  container?: Container,
): Promise<number | undefined> {
  const ctx = makeCtx();
  let pipeline = Pipeline.send(ctx).through(pipes as never);
  if (container) pipeline = pipeline.via(container);
  await pipeline.then((c) => {
    if (!(c as HttpContext).response) (c as HttpContext).response = new Response("ok");
    return (c as HttpContext).response;
  });
  return ctx.response?.status;
}

afterEach(() => RateLimiter.clear());

describe("ThrottleMiddleware through the Pipeline", () => {
  it("counts across requests even though the pipeline builds a new instance each time", async () => {
    const Limited = ThrottleMiddleware.with({ maxAttempts: 2, windowSeconds: 60 });

    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 6; i++) statuses.push(await serve([Limited as never]));

    expect(statuses).toEqual([200, 200, 429, 429, 429, 429]);
  });

  it("keeps separate .with() call sites on separate counters", async () => {
    const Tight = ThrottleMiddleware.with({ maxAttempts: 1, windowSeconds: 60 });
    const Loose = ThrottleMiddleware.with({ maxAttempts: 5, windowSeconds: 60 });

    expect(await serve([Tight as never])).toBe(200);
    expect(await serve([Tight as never])).toBe(429);

    // Exhausting Tight must not have consumed any of Loose's budget.
    expect(await serve([Loose as never])).toBe(200);
    expect(await serve([Loose as never])).toBe(200);
  });

  it("behaves identically when a container is attached", async () => {
    // `.via(container)` takes the container-resolution branch. Middleware is not registered,
    // so this must fall through to direct instantiation without changing the outcome — and
    // without the per-pipe thrown BindingNotFoundError the old implementation relied on.
    const container = new Container();
    const Limited = ThrottleMiddleware.with({ maxAttempts: 2, windowSeconds: 60 });

    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 4; i++) statuses.push(await serve([Limited as never], container));

    expect(statuses).toEqual([200, 200, 429, 429]);
  });
});

describe("RateLimiter.middleware() through the Pipeline", () => {
  it("is registerable on a route — it returns a class, not an instance", async () => {
    RateLimiter.for("login").limit(3).every(60).register();
    const LoginLimit = RateLimiter.middleware("login");

    // The documented usage is `Router.post(..., [RateLimiter.middleware('login')])`, so the
    // value must be `new`-able. Returning an instance made every such route throw
    // `TypeError: ThrottleMiddleware is not a constructor` on the first request.
    expect(typeof LoginLimit).toBe("function");
    expect(() => new LoginLimit()).not.toThrow();

    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 5; i++) statuses.push(await serve([LoginLimit as never]));

    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it("gives each named limiter its own counter", async () => {
    RateLimiter.for("a").limit(1).every(60).register();
    RateLimiter.for("b").limit(1).every(60).register();

    expect(await serve([RateLimiter.middleware("a") as never])).toBe(200);
    expect(await serve([RateLimiter.middleware("a") as never])).toBe(429);
    // "b" must be untouched by "a" being exhausted.
    expect(await serve([RateLimiter.middleware("b") as never])).toBe(200);
  });

  it("shares counters between the route class and the imperative API", async () => {
    RateLimiter.for("shared").limit(2).every(60).register();

    expect(await serve([RateLimiter.middleware("shared") as never])).toBe(200);
    expect(await serve([RateLimiter.middleware("shared") as never])).toBe(200);
    expect(await serve([RateLimiter.middleware("shared") as never])).toBe(429);

    // resetFor() reaches the same bucket the pipeline has been writing to.
    RateLimiter.resetFor("shared", makeCtx());
    expect(await serve([RateLimiter.middleware("shared") as never])).toBe(200);
  });
});
