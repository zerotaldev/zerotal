// ── Decorator metadata registries ─────────────────────────────────────────────
//
// Standard TC39 decorators, keyed by the class prototype; the `get*` readers walk the
// prototype chain so subclasses inherit.
//
// METHOD / GETTER decorators (@computed, @expose on a method, @renderless, @task, @on) CANNOT
// rely on `addInitializer` either. Bun 1.3.x does not reliably run a method decorator's
// initializers on construction: a class whose SUBCLASS declares a decorated field never runs the
// base's method initializers at all, so a shared page base's `@expose` action silently vanished
// from the allowlist the moment a subclass added one `@expose` field — and since the un-@exposed
// action check is fatal, a legitimate action was then rejected at runtime. It reproduces with no
// mixin and no framework code (a bare `class Sub extends Base` on Bun 1.3.14).
//
// So method/getter decorators TAG the function object itself in the decorator body — which runs
// synchronously, with the right name, always — and the `get*` readers scan the prototype chain
// for tagged members on first read (`_scanProto`). Registration lands on the DECLARING prototype,
// which is what makes inheritance work through `_collect`'s existing chain walk. `addInitializer`
// is still called as a belt-and-braces fallback: it is harmless when it fires (the registries are
// Sets keyed by prototype) and it covers members a prototype scan cannot see.
//
// FIELD decorators (@expose on a field, @locked, @reactive, @modelable, @transient,
// @validate, @url, @session) CANNOT defer to a field initializer or to `addInitializer`:
// Bun 1.3.x cross-wires those across every class defined in one file (a class runs another
// class's initializers, and a name captured in the closure resolves to the LAST class in
// the file). The only reliable signal is the decorator BODY, which runs synchronously with
// the correct `context.name`. So field decorators capture {name, apply} into a module
// buffer at definition time; the buffer is drained lazily the first time a `get*` reader is
// called for a class — we construct a probe instance to learn that class's own field names
// and match the buffered entries by name (see `_drainFields`).

import type { RuleBuilder, FieldRule } from "@zerotal/validator";
import type { LooseEventName } from "./events.ts";

/**
 * A `@validate` rule: a callback that receives the validator's chain API and returns the built
 * field rule. This is the value passed to the {@link validate} decorator and the shape of each
 * entry in {@link ValidationRules}.
 *
 * @example
 * ```ts
 * const nameRule: ValidateBuilder = (rule) => rule.required().min(2).max(50);
 * ```
 *
 * @category Validation
 */
export type ValidateBuilder = (rule: RuleBuilder) => FieldRule;

const _computedProtos = new WeakMap<object, Set<string>>();
const _transientProtos = new WeakMap<object, Set<string>>();
const _exposedProps = new WeakMap<object, Set<string>>();
const _exposedMethods = new WeakMap<object, Set<string>>();
const _lockedProps = new WeakMap<object, Set<string>>();
const _renderlessMethods = new WeakMap<object, Set<string>>();
const _validateRules = new WeakMap<object, Map<string, ValidateBuilder>>();
const _onListeners = new WeakMap<object, Map<ListenerName, string>>();
const _urlProps = new WeakMap<object, Map<string, UrlOptions>>();
/**
 * prop -> where its value comes from:
 *   undefined  — the property's own name is the segment
 *   string     — that segment
 *   class      — whichever segment resolved to an instance of it
 */
const _routeParamProps = new WeakMap<object, Map<string, ParamSource>>();
const _sessionProps = new WeakMap<object, Map<string, SessionOptions>>();
const _reactiveProps = new WeakMap<object, Set<string>>();
const _modelableProps = new WeakMap<object, Set<string>>();
const _taskMethods = new WeakMap<object, Set<string>>();
const _presenceProps = new WeakMap<object, Map<string, PresenceChannel>>();
const _sharedProps = new WeakMap<object, Map<string, SharedChannel>>();

function _register(map: WeakMap<object, Set<string>>, proto: object, key: string): void {
  let s = map.get(proto);
  if (!s) {
    s = new Set();
    map.set(proto, s);
  }
  s.add(key);
}

function _registerMap<V, K = string>(
  map: WeakMap<object, Map<K, V>>,
  proto: object,
  key: K,
  value: V,
): void {
  let m = map.get(proto);
  if (!m) {
    m = new Map();
    map.set(proto, m);
  }
  m.set(key, value);
}

function _collect(map: WeakMap<object, Set<string>>, startProto: object): Set<string> {
  const result = new Set<string>();
  let proto: object | null = startProto;
  while (proto && proto !== Object.prototype) {
    const s = map.get(proto);
    if (s) for (const k of s) result.add(k);
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return result;
}

function _collectMap<V, K = string>(
  map: WeakMap<object, Map<K, V>>,
  startProto: object,
): Map<K, V> {
  const result = new Map<K, V>();
  let proto: object | null = startProto;
  while (proto && proto !== Object.prototype) {
    const m = map.get(proto);
    if (m) for (const [k, v] of m) if (!result.has(k)) result.set(k, v);
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return result;
}

/** Register against the instance's own prototype (from an initializer/addInitializer). */
function _registerOn(map: WeakMap<object, Set<string>>, self: unknown, key: string): void {
  _register(map, Object.getPrototypeOf(self as object) as object, key);
}

// ── Method/getter tagging (Bun addInitializer workaround) ─────────────────────
//
// See the header note. A method or getter decorator marks the function object it is handed
// (or, for @computed, the wrapper it returns); `_scanProto` later reads those marks off the
// prototype and populates the registries. Symbols so a mark can never collide with a user
// property, and non-enumerable so nothing serializes or copies them.

/** Which registry a tagged member belongs in. `on` also carries its event name. */
interface MemberTag {
  exposed?: boolean;
  renderless?: boolean;
  task?: boolean;
  computed?: boolean;
  /** The event name, or a resolver over the instance — see {@link ListenerName}. */
  on?: ListenerName;
}

// `unique symbol` (not a plain `symbol`) so the computed-key types below resolve.
const TAG: unique symbol = Symbol.for("zerotal.flow.memberTag");
const SCANNED: unique symbol = Symbol.for("zerotal.flow.scanned");

/** Attach/merge a tag on a decorated method or getter function. */
function _tag(fn: unknown, patch: MemberTag): void {
  if (typeof fn !== "function") return;
  const target = fn as { [TAG]?: MemberTag };
  if (!Object.prototype.hasOwnProperty.call(fn, TAG)) {
    // Own, non-enumerable slot — an inherited tag from an overridden base method must not leak.
    Object.defineProperty(fn, TAG, { value: {}, writable: true, configurable: true });
  }
  Object.assign(target[TAG] as MemberTag, patch);
}

/**
 * Populate the method/getter registries for one prototype from the tags its own members carry.
 * Idempotent and cheap: marked with a non-enumerable flag so it runs once per prototype.
 */
function _scanProto(proto: object): void {
  if (!proto || proto === Object.prototype) return;
  if (Object.prototype.hasOwnProperty.call(proto, SCANNED)) return;
  Object.defineProperty(proto, SCANNED, { value: true, configurable: true });

  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc) continue;
    // A method lives on `value`; a @computed getter on `get`.
    const fn: unknown = desc.value ?? desc.get;
    if (typeof fn !== "function") continue;
    if (!Object.prototype.hasOwnProperty.call(fn, TAG)) continue;
    const tag = (fn as { [TAG]?: MemberTag })[TAG];
    if (!tag) continue;

    if (tag.exposed) _register(_exposedMethods, proto, name);
    if (tag.renderless) _register(_renderlessMethods, proto, name);
    if (tag.task) _register(_taskMethods, proto, name);
    if (tag.computed) _register(_computedProtos, proto, name);
    if (tag.on !== undefined) _registerMap(_onListeners, proto, tag.on, name);
  }
}

/** Scan `startProto` and every prototype above it, so inherited members register too. */
function _scanChain(startProto: object | null): void {
  for (let p = startProto; p && p !== Object.prototype; p = Object.getPrototypeOf(p) as object) {
    _scanProto(p);
  }
}

// ── Field-decorator buffer (Bun standard-decorator workaround) ────────────────

interface PendingField {
  name: string;
  apply: (proto: object) => void;
  /**
   * `context.metadata` — one object per **file**, not per class (Bun shares it across
   * every class defined in the same module). It is the only link back to where a
   * buffered entry came from, because `Symbol.metadata` never reaches the class, so
   * there is nothing to read at drain time.
   *
   * It is enough for the case that matters: a class may only claim registrations
   * enqueued by its own file. Without it, a component that declares `count` and is
   * never read leaves that entry in the buffer forever, and the next class in a
   * *different* file with an own field called `count` claims it — silently getting
   * the wrong decorator, and never getting its own.
   */
  group: object | undefined;
}
const _pendingFields: PendingField[] = [];
const _drainedProtos = new WeakSet<object>();

/** Enqueue a field registration captured (with the correct name) in the decorator body. */
function _enqueueField(name: string, apply: (proto: object) => void, group?: object): void {
  _pendingFields.push({ name, apply, group });
}

/**
 * Drain the buffered field registrations belonging to `ctor` onto its prototype. Called
 * lazily by the readers. We construct a throwaway instance to discover the class's own field
 * names IN DECLARATION ORDER (`Object.keys`), then claim the longest contiguous run of buffered
 * entries whose names map to STRICTLY INCREASING positions in that order. A class's field
 * decorators run consecutively at definition time (including a subclass's mixin-supplied fields)
 * and in declaration order, so its block is exactly such a run.
 *
 * The search is scoped to one FILE's entries at a time, newest first — see
 * {@link PendingField.group}. Scanning the whole buffer let a class claim a same-named
 * entry left behind by an unrelated file, which is invisible: it gets the wrong
 * decorator and never gets its own.
 *
 * The strictly-increasing constraint is what makes this robust when two classes share field
 * names AND their blocks are adjacent in the buffer (e.g. AddTransactionModal and TransferModal
 * both declare `accountId`/`open`/`fAmount`). A plain "longest run ⊆ own" would greedily extend
 * one class's run into the neighbour's leading shared fields; but those shared names map to
 * EARLIER positions in this class's declaration order, so the increasing check stops the run at
 * the true block boundary. Keeps multiple decorators on one field (e.g. `@expose @url page`)
 * together (same name → same index, but they're adjacent duplicates — handled by allowing equal
 * only when it's the identical consecutive name).
 */
function _drainFields(ctor: unknown): void {
  if (typeof ctor !== "function") return;
  const proto = (ctor as { prototype?: object }).prototype;
  if (!proto || _drainedProtos.has(proto)) return;
  _drainedProtos.add(proto); // mark first to stay re-entrancy-safe during the probe
  if (_pendingFields.length === 0) return;

  // The fields THIS class declares — not the ones it inherits. Instance fields all
  // land on the instance whoever declared them, so `Object.keys(new Derived())` also
  // lists the base's; subtracting the base's own probe leaves this class's block.
  //
  // The difference is load-bearing, not tidiness. `PaginatedPage extends
  // Pagination(Component)` inherits `page`, so an undrained `[page, page]` group left
  // by *another* `Pagination(...)` application matched it — and being two entries long
  // it beat `PaginatedPage`'s own one-entry `[rows]`. The subclass silently ended up
  // with the mixin's decorators and none of its own.
  //
  // If the base cannot be constructed without arguments there is nothing to subtract,
  // and the full key set is the same answer this used to give.
  let ownIndex: Map<string, number>;
  try {
    const keys = Object.keys(new (ctor as new () => object)());
    const base = Object.getPrototypeOf(ctor) as unknown;
    let inherited: Set<string> | undefined;
    if (typeof base === "function" && base !== Function.prototype) {
      try {
        inherited = new Set(Object.keys(new (base as new () => object)()));
      } catch {
        inherited = undefined;
      }
    }
    const declared = inherited ? keys.filter((k) => !inherited.has(k)) : keys;
    ownIndex = new Map(declared.map((k, i) => [k, i]));
  } catch {
    return; // not constructible without args — nothing we can match
  }

  // Match within one class's entries at a time — see {@link PendingField.group}.
  //
  // Scanning the buffer as one flat list let a class claim a same-named entry left
  // behind by an unrelated class, and that is invisible when it happens: the class
  // silently gets the wrong decorator and never gets its own. It is not
  // hypothetical — a component that declares a field and is never read leaves its
  // entry buffered for the life of the process, and names like `count`, `open` and
  // `page` are declared all over a codebase.
  //
  // Groups are keyed by identity rather than by adjacency, because a class's entries
  // need not be contiguous: an import evaluated part-way through a module interleaves
  // another file's.
  const groups: object[] = [];
  const byGroup = new Map<object, number[]>();
  const NO_GROUP = {}; // stand-in key, so entries without metadata still group together
  for (let i = 0; i < _pendingFields.length; i++) {
    const key = _pendingFields[i]!.group ?? NO_GROUP;
    let list = byGroup.get(key);
    if (!list) {
      list = [];
      byGroup.set(key, list);
      groups.push(key);
    }
    list.push(i);
  }

  // Best run across every group, NOT the first group that matches anything. A class
  // whose own group is a two-field block must beat an unrelated group that happens to
  // share one of those names, and only the length says so. Ties go to the most
  // recently enqueued group: a class is drained after its own definition, so among
  // equal candidates the newest is the one that just defined it, and older equals are
  // leftovers by construction.
  //
  // Restricted first to groups this class could plausibly own: every name in the
  // group is a field this class DECLARES. A sibling's group is rejected by the
  // names it has that this class does not.
  //
  // Length alone was not enough to separate siblings of one decorated base. Given
  // `NewPage { project }` and `EditPage { project, issue }` over a shared base, a
  // drain of NewPage scanned every group, found `project` at the head of EditPage's
  // group, tied on length with its own single entry, and — ties going to the newest
  // group — claimed EditPage's `project` and spliced it away. EditPage then drained
  // to `issue` alone, its `project` never registered, and route-param seeding skipped
  // the field: a 500 on `this.project.slug` that appeared only when the sibling
  // rendered first. Containment separates them, because `issue` is not a field
  // NewPage declares.
  //
  // Falls back to every group when nothing is fully contained, so partial matches —
  // including entries buffered without metadata, which share one bucket — behave as
  // they did.
  const contained = groups.filter((key) =>
    byGroup.get(key)!.every((i) => ownIndex.has(_pendingFields[i]!.name)),
  );
  const candidates = contained.length > 0 ? contained : groups;

  let bestIdxs: number[] | null = null;
  let bestLen = 0;
  let bestGroup = -1;
  for (let g = 0; g < candidates.length; g++) {
    const idxs = byGroup.get(candidates[g]!)!;

    // Longest contiguous run whose names map to strictly-increasing declaration-order
    // indices (equal allowed only for an identical repeated name — multiple decorators
    // on one field). "Contiguous" is within this group's entries.
    for (let i = 0; i < idxs.length; i++) {
      if (!ownIndex.has(_pendingFields[idxs[i]!]!.name)) continue;
      let last = -1;
      let lastName = "";
      let j = i;
      while (j < idxs.length) {
        const name = _pendingFields[idxs[j]!]!.name;
        const idx = ownIndex.get(name);
        if (idx === undefined) break;
        if (idx < last || (idx === last && name !== lastName)) break;
        last = idx;
        lastName = name;
        j++;
      }
      // Longer always wins. On a tie, a LATER group wins (newest definition), but an
      // earlier run within the SAME group is kept — which is the previous behaviour.
      const len = j - i;
      if (len > bestLen || (len === bestLen && len > 0 && g > bestGroup)) {
        bestLen = len;
        bestIdxs = idxs.slice(i, j);
        bestGroup = g;
      }
    }
  }
  if (!bestIdxs || bestLen === 0) return;

  // Apply, then remove the claimed entries. Removal is by descending buffer index so
  // the earlier positions stay valid while splicing.
  for (const bufIdx of bestIdxs) _pendingFields[bufIdx]!.apply(proto);
  for (let k = bestIdxs.length - 1; k >= 0; k--) {
    _pendingFields.splice(bestIdxs[k]!, 1);
  }
}

/** Drain via an instance or a prototype before reading. */
function _ensureDrained(target: object): void {
  // target may be an instance (use its constructor) or a prototype (use .constructor).
  const ctor = (target as { constructor?: unknown }).constructor;
  if (typeof ctor !== "function") {
    _drainFields(ctor);
    return;
  }
  // Drain base-most ancestor → derived, so fields DECLARED on a base class register
  // on the *base* prototype (shared by every subclass) instead of on whichever
  // subclass is constructed first. Without this, sibling subclasses of a decorated
  // base (e.g. one generated page class per admin resource) never inherit the base's
  // @url/@expose/@locked props, so their URL/state binding silently breaks.
  const chain: unknown[] = [];
  for (
    let c: unknown = ctor;
    typeof c === "function" && (c as { prototype?: object }).prototype;
    c = Object.getPrototypeOf(c)
  ) {
    chain.unshift(c);
  }
  for (const cls of chain) _drainFields(cls);
}

// Field decorators capture their name+registration in the BODY (correct name) and enqueue
// it; they do NOT transform the field, so the field's own initializer (default value) runs
// unchanged. Registration happens later, on first read, via `_drainFields`.
function _fieldDecorator(
  register: (proto: object, name: string) => void,
): (value: unknown, context: ClassFieldDecoratorContext) => void {
  return (_value, context) => {
    const name = String(context.name);
    _assertField(name, context);
    _enqueueField(name, (proto) => register(proto, name), context.metadata);
  };
}

/**
 * Reject a field-style decorator applied to a getter/setter/accessor. A `@computed`
 * getter (and any accessor) has no writable snapshot storage, so `@locked`/`@expose`/…
 * on it would serialize a value the framework then tries to write back on update —
 * clobbering the getter. TypeScript already flags this (the decorator's context type
 * excludes getters), but Bun runs code without typechecking, so guard at runtime too.
 */
function _assertField(name: string, context: { kind: string }): void {
  if (context.kind !== "field") {
    throw new Error(
      `[Flow] "${name}" — @locked/@url/@session/@transient/@reactive/@modelable can only ` +
        `decorate a field, not a ${context.kind}. A getter isn't stored in the snapshot; ` +
        `use @computed for a derived value (it renders as static server text).`,
    );
  }
}

export function getComputedKeys(instance: object): Set<string> {
  const proto = Object.getPrototypeOf(instance) as object;
  _scanChain(proto);
  return _collect(_computedProtos, proto);
}
export function getTransientKeys(instance: object): Set<string> {
  _ensureDrained(instance);
  return _collect(_transientProtos, Object.getPrototypeOf(instance) as object);
}
export function getExposedProps(instance: object): Set<string> {
  _ensureDrained(instance);
  return _collect(_exposedProps, Object.getPrototypeOf(instance) as object);
}
export function getLockedProps(instance: object): Set<string> {
  _ensureDrained(instance);
  return _collect(_lockedProps, Object.getPrototypeOf(instance) as object);
}
export function getExposedMethods(PageClass: { prototype: object }): Set<string> {
  _scanChain(PageClass.prototype as object);
  return _collect(_exposedMethods, PageClass.prototype as object);
}
/** `@task` method names — streaming, cancellable long-running actions. */
export function getTaskMethods(PageClass: { prototype: object }): Set<string> {
  _scanChain(PageClass.prototype as object);
  return _collect(_taskMethods, PageClass.prototype as object);
}
export function getRenderlessMethods(PageClass: { prototype: object }): Set<string> {
  _scanChain(PageClass.prototype as object);
  return _collect(_renderlessMethods, PageClass.prototype as object);
}
export function getValidateRules(instance: object): Map<string, ValidateBuilder> {
  _ensureDrained(instance);
  return _collectMap(_validateRules, Object.getPrototypeOf(instance) as object);
}
export function getListeners(PageClass: { prototype: object }): Map<ListenerName, string> {
  _scanChain(PageClass.prototype as object);
  return _collectMap<string, ListenerName>(_onListeners, PageClass.prototype as object);
}
export function getUrlProps(instance: object): Map<string, UrlOptions> {
  _ensureDrained(instance);
  return _collectMap(_urlProps, Object.getPrototypeOf(instance) as object);
}
export function getSessionProps(instance: object): Map<string, SessionOptions> {
  _ensureDrained(instance);
  return _collectMap(_sessionProps, Object.getPrototypeOf(instance) as object);
}

/**
 * The session key a `@session` field reads and writes.
 *
 * Plain by default — `@session userId` is the session's own `userId`, the same value any
 * controller or other component sees. `scoped: true` namespaces it to the component instead,
 * for state that belongs to this one page and should not collide with anything else.
 */
export function sessionKeyFor(prop: string, opts: SessionOptions, componentName: string): string {
  const key = opts.key ?? prop;
  return opts.scoped ? `flow:${componentName}:${key}` : key;
}
/** Reactive-prop names. Accepts a prototype directly (e.g. ChildClass.prototype). */
export function getReactiveProps(proto: object): Set<string> {
  _ensureDrained(proto);
  return _collect(_reactiveProps, proto);
}
/** Modelable-prop names. Accepts a prototype directly (e.g. ChildClass.prototype). */
export function getModelableProps(proto: object): Set<string> {
  _ensureDrained(proto);
  return _collect(_modelableProps, proto);
}
/** `@presence` props → their channel resolver, for the instance's class. */
export function getPresenceProps(instance: object): Map<string, PresenceChannel> {
  _ensureDrained(instance);
  return _collectMap(_presenceProps, Object.getPrototypeOf(instance) as object);
}
/** `@shared` props → their channel resolver, for the instance's class. */
export function getSharedProps(instance: object): Map<string, SharedChannel> {
  _ensureDrained(instance);
  return _collectMap(_sharedProps, Object.getPrototypeOf(instance) as object);
}

// ── @computed ─────────────────────────────────────────────────────────────────

/** Wrap a getter so it memoizes its result while a render pass is active. */
function _memoizeGetter(orig: () => unknown, name: string): () => unknown {
  return function (this: Record<string, unknown>): unknown {
    if (!this["__flowComputing"]) return orig.call(this); // only cache during render
    let cache = this["__flowComputed"] as Map<string, unknown> | undefined;
    if (!cache) {
      cache = new Map();
      this["__flowComputed"] = cache;
    }
    if (cache.has(name)) return cache.get(name);
    const v = orig.call(this);
    cache.set(name, v);
    return v;
  };
}

/**
 * Marks a getter as computed — a value derived from other state, excluded from the snapshot.
 *
 * @remarks
 * A computed getter is not serialized and is not client-writable; it renders as static
 * server-produced text. The result is memoized for the duration of a single render pass
 * — an expensive getter read several times in one template
 * runs once. The cache is scoped to the active render (see `_renderFlowPage`), so reads
 * outside rendering always recompute and never go stale. Apply only to a getter — a field-style
 * decorator on it is rejected; conversely `@computed` on a non-getter is a TypeScript error.
 *
 * @example
 * ```tsx
 * class Cart extends Component {
 *   @expose items: LineItem[] = [];
 *
 *   @computed get total(): number {
 *     return this.items.reduce((sum, i) => sum + i.price * i.qty, 0);
 *   }
 * }
 * ```
 *
 * @category Reactivity
 */
export function computed<This, Return>(
  getter: (this: This) => Return,
  context: ClassGetterDecoratorContext<This, Return>,
): (this: This) => Return {
  const name = String(context.name);

  context.addInitializer(function (this: This) {
    _registerOn(_computedProtos, this, name);
  });
  const memoized = _memoizeGetter(getter, name);
  // Tag the wrapper we return — that is what lands on the prototype, not `getter`.
  _tag(memoized, { computed: true });
  return memoized as (this: This) => Return;
}

// ── @transient ────────────────────────────────────────────────────────────────

/**
 * Marks a field as transient — excluded from the snapshot entirely.
 *
 * @remarks
 * Unlike `@computed` (which is derived and re-runs each render), a transient field is ordinary
 * server-side state that simply never crosses the wire and is not persisted between requests:
 * it holds its default value at the start of each render and is invisible to the client. Use it
 * for server-only scratch state (caches, handles, injected services) that must not be serialized.
 * Applies only to a field; a getter/accessor is rejected at runtime.
 *
 * @example
 * ```tsx
 * class Report extends Component {
 *   // Server-only handle — never serialized to the client.
 *   @transient private db!: DatabaseConnection;
 * }
 * ```
 *
 * @category Exposure & state
 */
export const transient = _fieldDecorator((proto, name) => _register(_transientProtos, proto, name));

// ── @expose ───────────────────────────────────────────────────────────────────

type ExposeContext = ClassFieldDecoratorContext | ClassMethodDecoratorContext;

/**
 * The opt-in network boundary: makes a member reachable from the client and crosses the wire.
 *
 * @remarks
 * On a **field**, the property is included in the snapshot and is mutable by the client (e.g. via
 * `flow:model`), so it round-trips both directions. On a **method**, the method becomes callable
 * from the browser over the WebSocket as an action. Nothing not marked (directly or via a
 * decorator that implies it, such as `@locked`, `@task`, `@on`, `@reactive`, `@modelable`,
 * `@presence`, `@shared`) is exposed. Rejected on a getter/accessor — use `@computed` for a
 * derived value, or an `@expose` field for client-writable state.
 *
 * @example
 * ```tsx
 * class Counter extends Component {
 *   @expose count = 0;
 *
 *   @expose increment() {
 *     this.count++;
 *   }
 * }
 * ```
 *
 * @category Exposure & state
 */
export function expose(_value: unknown, context: ExposeContext): void {
  const name = String(context.name);
  const kind = (context as { kind: string }).kind;
  if (kind !== "field" && kind !== "method") {
    throw new Error(
      `[Flow] @expose can only decorate a field or a method, not a ${kind} ("${name}"). ` +
        `A getter isn't stored in the snapshot; use @computed for a derived value ` +
        `(it renders as static server text), or an @expose field for client-writable state.`,
    );
  }
  if (context.kind === "field") {
    // Field: capture in the body and enqueue (see _fieldDecorator / _drainFields).
    _enqueueField(name, (proto) => _register(_exposedProps, proto, name), context.metadata);
    return;
  }
  // Method: tag the function so `_scanProto` finds it on the DECLARING prototype (see header);
  // addInitializer stays as a fallback for anything a prototype scan cannot reach.
  _tag(_value, { exposed: true });
  context.addInitializer(function (this: unknown) {
    _registerOn(_exposedMethods, this, name);
  });
}

// ── @locked ───────────────────────────────────────────────────────────────────

/**
 * Marks a field as exposed but read-only client-side: it is included in the snapshot (the client
 * can read/render it) but the client cannot mutate it via `flow:model`.
 *
 * @remarks
 * `@locked` implies `@expose` (it registers the prop as exposed) while additionally flagging it
 * as locked, so client-originated writes are rejected. Use it for server-authoritative state the
 * UI displays but must not change directly — the value only moves via server actions. Applies to
 * a field only.
 *
 * @example
 * ```tsx
 * class Profile extends Component {
 *   // Client renders it, but cannot bind it with flow:model.
 *   @locked role = "member";
 * }
 * ```
 *
 * @category Exposure & state
 */
export const locked = _fieldDecorator((proto, name) => {
  _register(_exposedProps, proto, name);
  _register(_lockedProps, proto, name);
});

// ── @presence ─────────────────────────────────────────────────────────────────
// Binds a property to a broadcast presence channel: the framework keeps it filled
// with the live member list (who's here), updating on join/leave. The channel is
// resolved per-instance — a static string, or a `(self) => string` for dynamic rooms.
// The prop is server-controlled (locked): in the snapshot, not client-writable.

/**
 * A presence channel identifier: either a static channel name, or a resolver called with the
 * component instance to compute a per-instance name (for dynamic rooms).
 *
 * @category Realtime
 */
export type PresenceChannel = string | ((self: Record<string, any>) => string);

/**
 * Binds a field to a broadcast presence channel — the framework keeps it filled with the live
 * member list (who's here), updating on join/leave.
 *
 * @remarks
 * The channel is resolved per-instance: pass a static string, or a `(self) => string` resolver
 * for dynamic rooms. The bound prop is server-controlled — like `@locked`, it is included in the
 * snapshot but is not client-writable. Applies to a field only.
 *
 * @param channel - The channel name, or a resolver over the component instance.
 * @returns A field decorator that registers the presence binding.
 *
 * @example
 * ```tsx
 * class RoomHeader extends Component {
 *   @presence((self) => `room.${self.roomId}`)
 *   members: PresenceMember[] = [];
 *
 *   @locked roomId = "";
 * }
 * ```
 *
 * @category Realtime
 */
export function presence(
  channel: PresenceChannel,
): (value: unknown, context: ClassFieldDecoratorContext) => void {
  return _fieldDecorator((proto, name) => {
    _registerMap(_presenceProps, proto, name, channel);
    // Serialized + read-only client-side, like @locked.
    _register(_exposedProps, proto, name);
    _register(_lockedProps, proto, name);
  });
}

/** Resolve a `@presence` channel for a component instance (adds no prefix). */
export function resolvePresenceChannel(channel: PresenceChannel, instance: object): string {
  return typeof channel === "function" ? channel(instance as Record<string, unknown>) : channel;
}

// ── @shared ─────────────────────────────────────────────────────────────────
// Binds a property to convergent, server-authoritative shared state on a broadcast
// channel: mutating it in an action writes to a per-channel room store and broadcasts
// to the channel, so every other subscriber's component re-reads and converges. The
// channel resolves per-instance (a static string, or `(self) => string` for dynamic
// rooms), the same shape as @presence — so one "room" channel can carry both who's-here
// (@presence) and shared state (@shared). Serialized + read-only client-side (@locked):
// clients render it but can only change it through @expose actions (last-write-wins).

/**
 * A shared-state channel identifier: either a static channel name, or a resolver called with the
 * component instance to compute a per-instance name (for dynamic rooms).
 *
 * @category Realtime
 *
 * @internal
 */
export type SharedChannel = string | ((self: Record<string, any>) => string);

/**
 * Binds a field to convergent, server-authoritative shared state on a broadcast channel.
 *
 * @remarks
 * Mutating the field inside an action writes to a per-channel room store and broadcasts to the
 * channel, so every other subscriber's component re-reads and converges (last-write-wins). The
 * channel resolves per-instance (a static string, or `(self) => string` for dynamic rooms) — the
 * same shape as {@link presence}, so one "room" channel can carry both who's-here (`@presence`)
 * and shared state (`@shared`). Serialized and read-only client-side (like `@locked`): clients
 * render it but can only change it through `@expose` actions. Applies to a field only.
 *
 * @param channel - The channel name, or a resolver over the component instance.
 * @returns A field decorator that registers the shared-state binding.
 *
 * @example
 * ```tsx
 * class Whiteboard extends Component {
 *   @shared((self) => `board.${self.boardId}`)
 *   strokes: Stroke[] = [];
 *
 *   @locked boardId = "";
 *
 *   @expose addStroke(stroke: Stroke) {
 *     this.strokes = [...this.strokes, stroke]; // broadcasts to every subscriber
 *   }
 * }
 * ```
 *
 * @category Realtime
 */
export function shared(
  channel: SharedChannel,
): (value: unknown, context: ClassFieldDecoratorContext) => void {
  return _fieldDecorator((proto, name) => {
    _registerMap(_sharedProps, proto, name, channel);
    // Serialized + read-only client-side, like @locked — writes go through actions.
    _register(_exposedProps, proto, name);
    _register(_lockedProps, proto, name);
  });
}

/** Resolve a `@shared` channel for a component instance (adds no prefix). */
export function resolveSharedChannel(channel: SharedChannel, instance: object): string {
  return typeof channel === "function" ? channel(instance as Record<string, unknown>) : channel;
}

// ── @reactive ───────────────────────────────────────────────────────────────
// A child-component prop the PARENT can push new values into on every re-render.
// Included in the snapshot and client-writable (so the framework can deliver
// parent updates), and re-emitted by the parent so the child re-renders when the
// bound value changes.

/**
 * Marks a child-component prop as reactive — the parent re-pushes new values into it on every
 * re-render.
 *
 * @remarks
 * The prop is included in the snapshot and is client-writable (so the framework can deliver the
 * parent's updates), and the parent re-emits it so the child re-renders when the bound value
 * changes. This is a one-way parent→child binding; use `@modelable` for two-way.
 * Applies to a field only.
 *
 * @example
 * ```tsx
 * class PriceTag extends Component {
 *   // Re-pushed by the parent whenever the parent's bound value changes.
 *   @reactive amount = 0;
 * }
 * ```
 *
 * @category Reactivity
 */
export const reactive = _fieldDecorator((proto, name) => {
  _register(_exposedProps, proto, name);
  _register(_reactiveProps, proto, name);
});

// ── @modelable ────────────────────────────────────────────────────────────────
// A reactive prop that ALSO syncs back to the parent: `value={this.x}` on a child
// component binds the parent's `x` to the child's modelable prop both ways.
// A modelable prop is implicitly reactive.

/**
 * Marks a child-component prop as two-way bound to the parent (parent↔child).
 *
 * @remarks
 * A modelable prop is reactive (the parent pushes new values in on re-render) AND syncs back:
 * `value={this.x}` on a child component binds the parent's `x` to the child's modelable prop in
 * both directions. A modelable prop is implicitly reactive (it registers as both).
 * Applies to a field only.
 *
 * @example
 * ```tsx
 * class TextField extends Component {
 *   // Parent binds with `value={this.query}`; edits here flow back to the parent.
 *   @modelable value = "";
 * }
 * ```
 *
 * @category Reactivity
 */
export const modelable = _fieldDecorator((proto, name) => {
  _register(_exposedProps, proto, name);
  _register(_reactiveProps, proto, name);
  _register(_modelableProps, proto, name);
});

// ── @renderless ───────────────────────────────────────────────────────────────

/**
 * Marks an action method as renderless — the action runs on the server but the follow-up
 * re-render is skipped.
 *
 * @remarks
 * Unlike `@task`, `@renderless` does NOT imply `@expose` — it only registers the method as
 * renderless, so it must be combined with `@expose` (or another decorator that exposes it) to be
 * callable from the client. Use it for side-effect-only actions whose result the UI does not need
 * to reflect (logging, fire-and-forget writes), avoiding the cost of a re-render and patch.
 * Applies to a method only.
 *
 * @example
 * ```tsx
 * class Analytics extends Component {
 *   @expose @renderless track(event: string) {
 *     this.logger.record(event); // no DOM update needed
 *   }
 * }
 * ```
 *
 * @category Actions
 */
export function renderless(_fn: unknown, context: ClassMethodDecoratorContext): void {
  _tag(_fn, { renderless: true });
  context.addInitializer(function (this: unknown) {
    _registerOn(_renderlessMethods, this, String(context.name));
  });
}

// ── @task ───────────────────────────────────────────────────────────────────────
// A long-running, cancellable action whose incremental field writes stream to the client.
// While a @task runs, the framework flushes throttled partial patches — so `this.answer +=
// token` appears live — keeps the triggering control in its loading state for the whole
// duration, and exposes `this.signal` (an AbortSignal) that `this.cancel()` on the client
// trips for cooperative cancellation. Auto-@expose (callable from the browser).

/**
 * Marks an async method as a streaming, cancellable task. Implicitly `@expose` (callable from the
 * browser).
 *
 * @remarks
 * While a `@task` runs, the framework flushes throttled partial patches — so incremental field
 * writes such as `this.answer += token` appear live in the client — keeps the triggering control
 * in its loading state for the whole duration, and exposes `this.signal` (an `AbortSignal`) that
 * `this.cancel()` on the client trips for cooperative cancellation. Because it auto-exposes, no
 * separate `@expose` is needed. Applies to a (typically async) method.
 *
 * @example
 * ```tsx
 * class Chat extends Component {
 *   @expose answer = "";
 *
 *   @task async ask(prompt: string) {
 *     for await (const token of streamCompletion(prompt, this.signal)) {
 *       this.answer += token; // each write streams to the client
 *     }
 *   }
 * }
 * ```
 *
 * @category Actions
 */
export function task(_fn: unknown, context: ClassMethodDecoratorContext): void {
  // `@task` implies `@expose` — it registers into the same allowlist.
  _tag(_fn, { exposed: true, task: true });
  context.addInitializer(function (this: unknown) {
    const proto = Object.getPrototypeOf(this as object) as object;
    const name = String(context.name);
    _register(_exposedMethods, proto, name);
    _register(_taskMethods, proto, name);
  });
}

// ── @validate ─────────────────────────────────────────────────────────────────

/**
 * Attaches a validation rule to a field using the framework validator's fluent chain.
 *
 * @remarks
 * The rule is read by `this.validate()` (called with no argument) and by real-time validation on
 * client update. `@validate` only registers the rule — it does not expose the field, so pair it
 * with `@expose` for client-editable inputs. Applies to a field only. The decorator-attached
 * rules mirror the object form accepted by `this.validate({ ... })` (see {@link ValidationRules}).
 *
 * @param build - A {@link ValidateBuilder} that builds the field rule from the chain API.
 * @returns A field decorator that registers the rule.
 *
 * @example
 * ```tsx
 * class SignupForm extends Component {
 *   @expose @validate((rule) => rule.required().min(2).max(50)) name = "";
 *   @expose @validate((rule) => rule.required().email()) email = "";
 *   @expose @validate((rule) => rule.required().min(8).confirmed()) password = "";
 * }
 * ```
 *
 * @category Validation
 */
export function validate(
  build: ValidateBuilder,
): (value: unknown, context: ClassFieldDecoratorContext) => void {
  return _fieldDecorator((proto, name) => _registerMap(_validateRules, proto, name, build));
}

// ── @on ───────────────────────────────────────────────────────────────────────

/**
 * What a `@on` listener listens to: a static event name, or a resolver called with the component
 * instance to compute one — the same shape as {@link PresenceChannel} and {@link SharedChannel}.
 *
 * Use the resolver form for a `socket:` channel whose name contains a value only the instance
 * knows. A template literal in a plain string cannot work: the decorator's argument is read off
 * the class, long before any instance exists, so `"socket:issues.${this.id},E"` subscribes to a
 * channel whose name contains those eleven characters.
 *
 * @example
 * ```ts
 * // Static — the channel is the same for every instance.
 * @on("socket:orders,OrderPlaced")
 *
 * // Per-instance — one channel per issue.
 * @on((self) => `socket-private:issues.${self.issue.id},CommentPosted`)
 * ```
 *
 * @category Realtime
 */
export type ListenerName = LooseEventName | ((self: Record<string, any>) => string); // eslint-disable-line @typescript-eslint/no-explicit-any -- `unknown` would break `self.issue.id`

/**
 * Binds a method as a cross-component (realtime) event listener. Auto-exposes the method.
 *
 * @remarks
 * When the named event is dispatched (via `dispatch` / `dispatchTo` / `dispatchSelf`, or an
 * `socket:…` broadcast), the decorated method is invoked with the event payload. The event name
 * autocompletes to the known {@link FlowEvents} contract while still accepting any string (for
 * `socket:…` broadcasts and gradually-typed events). Annotate the handler's parameter with
 * `EventPayload<"name">` to type the payload against the same contract. Because it auto-exposes,
 * no separate `@expose` is needed. Applies to a method.
 *
 * @param eventName - The event to listen for; a known {@link FlowEvents} key or any string.
 * @returns A method decorator that registers the listener.
 *
 * @example
 * ```tsx
 * class Feed extends Component {
 *   @expose posts: Post[] = [];
 *
 *   @on("post-created")
 *   onPostCreated(payload: EventPayload<"post-created">) {
 *     this.posts = [payload, ...this.posts];
 *   }
 * }
 * ```
 *
 * @category Realtime
 */
export function on(
  eventName: ListenerName,
): (fn: unknown, context: ClassMethodDecoratorContext) => void {
  return (_fn: unknown, context: ClassMethodDecoratorContext): void => {
    // `@on` implies `@expose`; the tag carries the event name so the scan can rebuild the map.
    _tag(_fn, { exposed: true, on: eventName });
    context.addInitializer(function (this: unknown) {
      const proto = Object.getPrototypeOf(this as object) as object;
      const name = String(context.name);
      _register(_exposedMethods, proto, name);
      _registerMap(_onListeners, proto, eventName, name);
    });
  };
}

/**
 * The listener names a component actually subscribes to, resolved against `instance`.
 *
 * A static name passes through; a resolver is called with the component, so an
 * `socket:` channel can carry a value only the instance knows — `issues.417` rather
 * than the class-level `issues.:id`.
 *
 * This exists because the channel name reaches the browser through the snapshot,
 * and the snapshot is built per instance. Registering `(self) => …` under the
 * *class* and resolving here is the same split {@link presence} and {@link shared}
 * already use; before it, a `@on("socket-private:issues.${this.issueId},…")`
 * written the way the guide showed subscribed to a channel literally containing
 * `${this.issueId}` — no error, no warning, and no events, because template
 * syntax inside a plain string is just text.
 *
 * A resolver that throws is dropped rather than allowed to fail the render: a
 * page whose live updates do not arrive is a degraded page, while a page that
 * 500s because one channel could not be named is no page at all.
 */
export function resolveListeners(
  listeners: Map<ListenerName, string>,
  instance: object,
): Map<string, string> {
  const resolved = new Map<string, string>();

  for (const [name, method] of listeners) {
    if (typeof name !== "function") {
      resolved.set(name, method);
      continue;
    }
    try {
      const channel = name(instance as Record<string, unknown>);
      if (typeof channel === "string" && channel !== "") resolved.set(channel, method);
    } catch {
      /* an unresolvable channel is not subscribed to */
    }
  }

  return resolved;
}

// ── @url ──────────────────────────────────────────────────────────────────────

/**
 * Options for the {@link url} decorator, controlling how a property maps onto the browser URL
 * query string.
 *
 * @category Persistence
 */
export interface UrlOptions {
  /** Override the URL query parameter name. Defaults to the property name. */
  as?: string;
  /** Push a new history entry or replace the current one. Defaults to `'replace'`. */
  history?: "push" | "replace";
}

type UrlDecorator = (value: unknown, context: ClassFieldDecoratorContext) => void;

/**
 * Syncs a field to the browser URL query string, so its value is reflected in and restored from
 * the URL.
 *
 * @remarks
 * Usable bare as `@url` (no parens) or configured as `@url({ as: 'page', history: 'push' })` — see
 * {@link UrlOptions}. By default the query parameter takes the property's name and updates
 * `replace` the current history entry.
 *
 * A URL-synced field is client-visible by definition, so `@url` **implies `@expose`** — no need
 * to write both. Add `@locked` for a value the client reads but the server owns. Applies to a
 * field.
 *
 * @param opts - Optional {@link UrlOptions} when called with parentheses.
 * @returns When configured, a field decorator; when used bare, nothing (applied directly).
 *
 * @example
 * ```tsx
 * class ProductList extends Component {
 *   @url page = 1;
 *   @url({ as: "q", history: "push" }) search = "";
 * }
 * ```
 *
 * @category Persistence
 */
export function url(value: unknown, context: ClassFieldDecoratorContext): void;
export function url(opts?: UrlOptions): UrlDecorator;
export function url(
  optsOrValue?: UrlOptions | unknown,
  context?: ClassFieldDecoratorContext,
): UrlDecorator | void {
  if (context !== undefined) {
    return _urlDecorator({})(optsOrValue, context); // bare @url
  }
  const opts = (optsOrValue ?? {}) as UrlOptions;
  return _urlDecorator(opts);
}

function _urlDecorator(opts: UrlOptions): UrlDecorator {
  return _fieldDecorator((proto, name) => {
    _registerMap(_urlProps, proto, name, opts);
    // A URL-synced field is client-visible by definition — its value is in the address bar,
    // and keeping it in sync means the client holds it. So @url implies @expose; add @locked
    // alongside it for a value the client reads but may not write.
    _register(_exposedProps, proto, name);
  });
}

// ── @param ────────────────────────────────────────────────────────────────────

type ParamDecorator = (value: unknown, context: ClassFieldDecoratorContext) => void;

/** A model class used as a `@param` token — matched against the resolved segment values. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any model constructor shape
export type ParamModel = abstract new (...args: any[]) => unknown;

/** Where a `@param` field reads from: a segment name, a model class, or its own name. */
export type ParamSource = string | ParamModel | undefined;

/** Fields bound to a route segment, with the source each one reads. */
export function getRouteParamProps(instance: object): Map<string, ParamSource> {
  _ensureDrained(instance);
  return _collectMap(_routeParamProps, Object.getPrototypeOf(instance) as object);
}

/**
 * Fills a field from the matched route segment before `onMount()` runs — including a
 * [route-model binding](/docs/routing#route-model-binding), so a page on `/posts/:post`
 * receives the loaded `Post` without querying for it.
 *
 * @remarks
 * Usable bare as `@param` (the field's own name is the segment), as `@param('slug')` to read a
 * differently-named segment, or as `@param(Post)` to take whichever segment resolved to an
 * instance of that model — so the field never has to track what a route called it. One model
 * claims one segment name, so the token form is unambiguous for anything binding implicitly;
 * a route that hand-binds a second segment to the same model yields the leftmost.
 *
 * Seeding happens **once, on the initial GET** — the only request that carries the URL's
 * segments. On subsequent WebSocket actions the value is restored from the snapshot instead
 * (a model through Flow's model synth), so pair it with `@locked` and the record is never
 * re-queried.
 *
 * `@param` registers the binding only; combine it with `@locked` for server-owned data, or
 * `@expose` if the client may also write it. Applies to a field.
 *
 * @param name - The route segment to read; defaults to the property's own name.
 * @returns When configured, a field decorator; when used bare, nothing (applied directly).
 *
 * @example
 * ```tsx
 * class PostDetailPage extends Component {
 *   @locked @param post!: Post;           // /posts/:post -> the bound Post
 *   @locked @param(Post) article!: Post;  // whichever segment resolved to a Post
 *   @locked @param("tab") activeTab = ""; // /posts/:post/:tab -> the raw segment
 * }
 * ```
 *
 * @category Persistence
 */
export function param(value: unknown, context: ClassFieldDecoratorContext): void;
export function param(source?: string | ParamModel): ParamDecorator;
export function param(
  sourceOrValue?: string | ParamModel | unknown,
  context?: ClassFieldDecoratorContext,
): ParamDecorator | void {
  if (context !== undefined) {
    return _paramDecorator(undefined)(sourceOrValue, context); // bare @param
  }
  return _paramDecorator(sourceOrValue as ParamSource);
}

function _paramDecorator(source: ParamSource): ParamDecorator {
  return _fieldDecorator((proto, prop) => _registerMap(_routeParamProps, proto, prop, source));
}

// ── @session ──────────────────────────────────────────────────────────────────

/** Options for {@link session}. */
export interface SessionOptions {
  /** Session key to read and write. Defaults to the property's own name. */
  key?: string;
  /**
   * Namespace the key to this component (`flow:<Component>:<key>`), so the value belongs to
   * this page alone and cannot collide with another component's field of the same name.
   * Default: `false` — the key is the session's own.
   */
  scoped?: boolean;
}

type SessionDecorator = (value: unknown, context: ClassFieldDecoratorContext) => void;

/**
 * Binds a field to the server-side session, so its value survives across page loads.
 *
 * @remarks
 * Requires `SessionMiddleware`. The field reads and writes the session's own key of the same
 * name, so `@session userId` is the same `userId` a controller sees — pass `{ key }` to read a
 * differently-named one, or `{ scoped: true }` to namespace it to this component instead.
 *
 * The value stays **server-side**: `@session` alone puts nothing in the snapshot, so the
 * browser never sees it and cannot write it. Add `@locked` for a value the client should read.
 * Applies to a field only.
 *
 * @param opts - Optional {@link SessionOptions} when called with parentheses.
 * @returns When configured, a field decorator; when used bare, nothing (applied directly).
 *
 * @example
 * ```tsx
 * class Preferences extends Component {
 *   @session userId = "";                          // the session's `userId`
 *   @session({ key: "s" }) whatever = 0;           // the session's `s`
 *   @session({ scoped: true }) draft = "";         // flow:Preferences:draft
 *   @locked @session theme = "light";              // readable by the client, server-owned
 * }
 * ```
 *
 * @category Persistence
 */
export function session(value: unknown, context: ClassFieldDecoratorContext): void;
export function session(opts?: SessionOptions): SessionDecorator;
export function session(
  optsOrValue?: SessionOptions | unknown,
  context?: ClassFieldDecoratorContext,
): SessionDecorator | void {
  if (context !== undefined) {
    return _sessionDecorator({})(optsOrValue, context); // bare @session
  }
  return _sessionDecorator((optsOrValue ?? {}) as SessionOptions);
}

function _sessionDecorator(opts: SessionOptions): SessionDecorator {
  return _fieldDecorator((proto, name) => _registerMap(_sessionProps, proto, name, opts));
}
