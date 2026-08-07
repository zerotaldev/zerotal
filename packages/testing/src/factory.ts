import type { BaseModel, InsertPayload } from "@zerotal/orm";
import { _suppressHooks } from "@zerotal/orm";
import { fake } from "./fake.ts";

type ModelCtor<T extends BaseModel> = (new () => T) & typeof BaseModel;

// ── Shared internal types ─────────────────────────────────────────────────────

/**
 * Keys of T whose names follow the camelCase foreign-key convention (*Id).
 * Matches: userId, postId, authorId, parentCategoryId, etc.
 * Does NOT match: id (handled by AutoManagedKeys in InsertPayload).
 */
type FKKeys<T> = {
  [K in keyof T & string]-?: K extends `${string}Id` ? K : never;
}[keyof T & string];

/**
 * The return type expected from a factory definition callback.
 *
 * Like InsertPayload<T> but with all foreign-key fields (*Id) made optional —
 * they are injected at create-time via `.for(model)` or explicit overrides,
 * so the factory definition does not need to supply them.
 *
 * Non-FK required fields (title, body, name, email, …) remain required,
 * giving the definition callback full type safety without false positives.
 */
export type FactoryPayload<T extends BaseModel> = Omit<
  InsertPayload<T>,
  FKKeys<T> & keyof InsertPayload<T>
> &
  Partial<Pick<InsertPayload<T>, FKKeys<T> & keyof InsertPayload<T>>>;

type DefinitionFn<T extends BaseModel> = (f: typeof fake) => FactoryPayload<T>;

interface FactoryConfig<T extends BaseModel> {
  forcedState: string | null;
  relations: Array<{ model: BaseModel; key: string }>;
  afterCallbacks: Array<(instance: T) => Promise<void> | void>;
  withEvents: boolean;
}

function _defaultConfig<T extends BaseModel>(): FactoryConfig<T> {
  return { forcedState: null, relations: [], afterCallbacks: [], withEvents: false };
}

async function _createOne<T extends BaseModel>(
  ModelClass: ModelCtor<T>,
  definition: DefinitionFn<T>,
  config: FactoryConfig<T>,
  overrides: Partial<InsertPayload<T>>,
): Promise<T> {
  const run = async (): Promise<T> => {
    // Merge order: definition defaults → relation FKs → caller overrides.
    // Relation FKs override definition defaults (a Post's userId must match the parent).
    // Bypasses fillable/guarded on purpose — factories are trusted code.
    const relData = config.relations.reduce<Record<string, unknown>>((acc, { model, key }) => {
      acc[key] = model.id;
      return acc;
    }, {});
    const data = { ...(definition(fake) as Record<string, unknown>), ...relData, ...overrides };

    const inst = new ModelClass();
    Object.assign(inst, data);
    await inst.save();

    if (config.forcedState) {
      await (inst as unknown as { forceState(s: string): Promise<void> }).forceState(
        config.forcedState,
      );
    }

    for (const cb of config.afterCallbacks) await cb(inst);
    return inst;
  };

  return config.withEvents ? run() : _suppressHooks(run);
}

// ── New class-based API: Factory<T> ──────────────────────────────────────────

/**
 * Fluent, type-safe model factory for tests and database seeders.
 *
 * Define once, use everywhere. The definition callback receives the built-in
 * `fake` helper for quick random data — or ignore it and use your own faker.
 *
 * @example
 * // database/factories/UserFactory.ts
 * export const UserFactory = Factory.define(User, (f) => ({
 *   name:     f.string(10),
 *   email:    f.email(),
 *   password: 'password',  // auto-hashed by BaseModel.hashable
 * }));
 *
 * // In a test:
 * const user   = await UserFactory.create({ name: 'Alice' });
 * const five   = await UserFactory.count(5).create();
 * const sub    = await SubscriptionFactory.state('expired').create();
 * const post   = await PostFactory.for(user).create();
 */
export class Factory<T extends BaseModel> {
  private constructor(
    protected readonly _ModelClass: ModelCtor<T>,
    protected readonly _definition: DefinitionFn<T>,
    protected readonly _config: FactoryConfig<T>,
  ) {}

  /** Define a factory for a model class. Returns a reusable `Factory<T>` instance. */
  static define<T extends BaseModel>(
    ModelClass: ModelCtor<T>,
    definition: DefinitionFn<T>,
  ): Factory<T> {
    return new Factory(ModelClass, definition, _defaultConfig());
  }

  /**
   * Force the created instance to `stateName` via `forceState()`,
   * bypassing all guards and `onTransition` callbacks.
   *
   * @example
   * const expired = await SubscriptionFactory.state('expired').create();
   */
  state(stateName: string): Factory<T> {
    return new Factory(this._ModelClass, this._definition, {
      ...this._config,
      forcedState: stateName,
    });
  }

  /**
   * Inject a parent model's primary key as a foreign key.
   * `foreignKey` defaults to `<ModelName>Id` (camelCase).
   *
   * @example
   * const post = await PostFactory.for(user).create();
   * const post = await PostFactory.for(user, 'authorId').create();
   */
  for(model: BaseModel, foreignKey?: string): Factory<T> {
    const name = model.constructor.name;
    const key = foreignKey ?? `${name.charAt(0).toLowerCase()}${name.slice(1)}Id`;
    return new Factory(this._ModelClass, this._definition, {
      ...this._config,
      relations: [...this._config.relations, { model, key }],
    });
  }

  /** Run `callback` after each instance is created. */
  afterCreate(callback: (instance: T) => Promise<void> | void): Factory<T> {
    return new Factory(this._ModelClass, this._definition, {
      ...this._config,
      afterCallbacks: [...this._config.afterCallbacks, callback],
    });
  }

  /**
   * Enable observer and hook dispatch for instances created by this factory.
   *
   * By default factories silence all model observers and hooks so that seeders
   * don't emit side-effects (logs, emails, jobs). Call `.dispatchEvents()` when
   * you explicitly need the full lifecycle to fire — e.g. in a test that asserts
   * a side-effect triggered by model creation.
   *
   * @example
   * // Seeder — silent by default, no "User registered" log spam
   * await UserFactory.count(20).create();
   *
   * // Test — assert the welcome email was queued
   * const user = await UserFactory.dispatchEvents().create();
   * Queue.assertDispatched(WelcomeEmailJob);
   */
  dispatchEvents(): Factory<T> {
    return new Factory(this._ModelClass, this._definition, {
      ...this._config,
      withEvents: true,
    });
  }

  /**
   * Switch to batch mode — `create()` will return `Promise<T[]>` instead of `Promise<T>`.
   *
   * @example
   * const users = await UserFactory.count(5).create();
   * //    ^? User[]
   */
  count(n: number): FactoryBatch<T> {
    return new FactoryBatch(this._ModelClass, this._definition, this._config, n);
  }

  /** Build an in-memory instance without touching the database. */
  make(overrides: Partial<InsertPayload<T>> = {}): T {
    const relData = this._config.relations.reduce<Record<string, unknown>>(
      (acc, { model, key }) => {
        acc[key] = model.id;
        return acc;
      },
      {},
    );
    const data = {
      ...(this._definition(fake) as Record<string, unknown>),
      ...relData,
      ...overrides,
    };
    const inst = new this._ModelClass();
    Object.assign(inst, data);
    return inst;
  }

  /** Insert a single instance into the database. */
  async create(overrides: Partial<InsertPayload<T>> = {}): Promise<T> {
    return _createOne(this._ModelClass, this._definition, this._config, overrides);
  }

  /** Insert `n` instances sequentially without switching to batch mode. */
  async createMany(n: number, overrides: Partial<InsertPayload<T>> = {}): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < n; i++) {
      results.push(await _createOne(this._ModelClass, this._definition, this._config, overrides));
    }
    return results;
  }
}

// ── FactoryBatch<T> ───────────────────────────────────────────────────────────

/** Returned by `Factory.count(n)`. `create()` returns `Promise<T[]>`. */
export class FactoryBatch<T extends BaseModel> {
  constructor(
    private readonly _ModelClass: ModelCtor<T>,
    private readonly _definition: DefinitionFn<T>,
    private readonly _config: FactoryConfig<T>,
    private readonly _n: number,
  ) {}

  state(stateName: string): FactoryBatch<T> {
    return new FactoryBatch(
      this._ModelClass,
      this._definition,
      { ...this._config, forcedState: stateName },
      this._n,
    );
  }

  for(model: BaseModel, foreignKey?: string): FactoryBatch<T> {
    const name = model.constructor.name;
    const key = foreignKey ?? `${name.charAt(0).toLowerCase()}${name.slice(1)}Id`;
    return new FactoryBatch(
      this._ModelClass,
      this._definition,
      { ...this._config, relations: [...this._config.relations, { model, key }] },
      this._n,
    );
  }

  afterCreate(callback: (instance: T) => Promise<void> | void): FactoryBatch<T> {
    return new FactoryBatch(
      this._ModelClass,
      this._definition,
      { ...this._config, afterCallbacks: [...this._config.afterCallbacks, callback] },
      this._n,
    );
  }

  /** Enable observer and hook dispatch. Silent by default — see `Factory.dispatchEvents()`. */
  dispatchEvents(): FactoryBatch<T> {
    return new FactoryBatch(
      this._ModelClass,
      this._definition,
      { ...this._config, withEvents: true },
      this._n,
    );
  }

  /**
   * Insert `n` instances sequentially and return them as an array.
   *
   * Sequential (not parallel) to stay compatible with SQLite's single-write
   * `last_insert_rowid()` behaviour. For Postgres this constraint doesn't apply
   * but serial inserts are correct on all databases.
   */
  async create(overrides: Partial<InsertPayload<T>> = {}): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < this._n; i++) {
      results.push(await _createOne(this._ModelClass, this._definition, this._config, overrides));
    }
    return results;
  }
}
