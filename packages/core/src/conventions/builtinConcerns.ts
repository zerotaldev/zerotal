/**
 * The convention concerns that core itself owns (events, listeners, jobs,
 * validators). ORM and auth contribute their own descriptors via
 * `app.registerConcern(...)` from their providers.
 */
import type { ConcernDescriptor } from "./ConventionLoader.ts";
import type { Emitter } from "../events/Emitter.ts";

/**
 * `app/events/` — event classes are plain classes that need no registration; importing them
 * makes them available and bundled (and lets a generated manifest reference them). Runs early
 * so any module-level side effects are in place before listeners bind.
 */
export const eventsConcern: ConcernDescriptor = {
  name: "events",
  order: 5,
  dir: "app/events",
  register() {
    /* importing the file is the whole effect */
  },
};

/**
 * `app/services/` — service classes auto-register with the container so
 * `App.make(MyService)` resolves them with the declared lifetime.
 *
 * A class opts into a non-default lifetime via a `static lifetime` flag:
 *
 * @example
 * @inject(Auth)
 * export class UsersService {
 *   static lifetime = "singleton";   // "singleton" | "scoped" | "transient"
 *   constructor(private auth: AuthManager) {}
 * }
 *
 * - `singleton` / `scoped` → bound with a factory that auto-wires a fresh
 *   instance via `container.build()`.
 * - `transient` or no flag → nothing is registered; the container already
 *   auto-wires unregistered classes on demand (so resolution still works, it is
 *   just a new instance each time). Only classes with an explicit lifetime are
 *   touched, so non-service exports (types, helpers) are ignored.
 *
 * Runs early (before listeners) so listeners and other concerns can depend on
 * services.
 */
export const servicesConcern: ConcernDescriptor = {
  name: "services",
  order: 10,
  dir: "app/services",
  register(serviceModule, ctx) {
    const container = ctx.app.container;
    for (const exported of Object.values(serviceModule)) {
      if (typeof exported !== "function") continue;
      const lifetime = (exported as { lifetime?: unknown }).lifetime;
      const ctor = exported as new (...args: unknown[]) => unknown;
      if (lifetime === "singleton") {
        container.singleton(ctor, (resolver) => resolver.build(ctor));
      } else if (lifetime === "scoped") {
        container.scoped(ctor, (resolver) => resolver.build(ctor));
      }
      // "transient" / undefined: rely on the container's on-demand auto-wiring.
    }
  },
};

/**
 * `app/listeners/` — a listener declares the event(s) it handles via `static listens`
 * (a single event class or an array). The loader binds it on the app emitter.
 *
 * @example
 * export class SendWelcomeEmail {
 *   static listens = UserRegistered;
 *   async handle(e: UserRegistered) { ... }
 * }
 */
export const listenersConcern: ConcernDescriptor = {
  name: "listeners",
  order: 40,
  dir: "app/listeners",
  register(listenerModule, ctx) {
    const emitter = ctx.resolve<Emitter>("events");
    if (!emitter) return;
    for (const exported of Object.values(listenerModule)) {
      if (typeof exported !== "function") continue;
      const listens = (exported as { listens?: unknown }).listens;
      if (!listens) continue;
      const events = Array.isArray(listens) ? listens : [listens];
      for (const event of events) {
        if (typeof event === "function") {
          emitter.on(event as never, exported as never);
        }
      }
    }
  },
};

/**
 * `app/jobs/` — queue job classes self-register via `JobRegistry.register()` at the bottom of
 * each file, so importing them is the whole effect (mirrors the generated jobs barrel, but for
 * the web/test/console runtimes too — not just the worker).
 */
export const jobsConcern: ConcernDescriptor = {
  name: "jobs",
  order: 50,
  dir: "app/jobs",
  register() {
    /* importing the file triggers its JobRegistry.register() side effect */
  },
};

/**
 * `app/validators/` — custom validation rules / FormRequest helpers. These register themselves
 * at module load (e.g. `Validator.extend(...)`), so importing the file is the effect.
 */
export const validatorsConcern: ConcernDescriptor = {
  name: "validators",
  order: 60,
  dir: "app/validators",
  register() {
    /* importing the file runs its module-level registration */
  },
};

/** The full set of core-owned convention concerns, in registration order. */
export const builtinConcerns: ConcernDescriptor[] = [
  eventsConcern,
  servicesConcern,
  listenersConcern,
  jobsConcern,
  validatorsConcern,
];
