/**
 * Fluent builder for contextual bindings: registers a dependency that is
 * resolved differently when injected into one specific consumer.
 */
import type { Container } from "./Container.ts";
import type { Binding, BindingToken, Factory } from "./types.ts";

/**
 * Configures how a single consumer receives a given dependency.
 *
 * Created via `Container.for(consumer)`; the `give*` methods return the
 * container so registration reads as one fluent statement.
 */
export class ContextualBindingBuilder<Consumer> {
  constructor(
    private readonly container: Container,
    private readonly consumer: BindingToken<Consumer>,
  ) {}

  /**
   * Canonicalise a token through the alias map at registration time.
   * This ensures the contextual map is always keyed by canonical tokens,
   * so _make()'s alias-then-contextual lookup always matches.
   */
  private canonical(token: unknown): unknown {
    return this.container._resolveAlias(token);
  }

  /** Give this consumer a fresh instance of `dependency` on each resolution */
  give<D>(dependency: BindingToken<D>, factory: Factory<D>): Container {
    this.container._setContextual(this.canonical(this.consumer), this.canonical(dependency), {
      kind: "transient",
      factory,
    } as Binding<D>);
    return this.container;
  }

  /** Give this consumer a singleton instance of `dependency` */
  giveSingleton<D>(dependency: BindingToken<D>, factory: Factory<D>): Container {
    this.container._setContextual(this.canonical(this.consumer), this.canonical(dependency), {
      kind: "singleton",
      factory,
      instance: undefined,
      resolved: false,
    } as Binding<D>);
    return this.container;
  }

  /** Give this consumer a pre-built value for `dependency` */
  giveValue<D>(dependency: BindingToken<D>, instance: D): Container {
    this.container._setContextual(this.canonical(this.consumer), this.canonical(dependency), {
      kind: "value",
      instance,
    } as Binding<D>);
    return this.container;
  }
}
