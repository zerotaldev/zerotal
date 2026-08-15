/**
 * The ORM's class-keyed registries — columns, relations, hooks, observers, global
 * scopes, state-machine callbacks — all key on the model class and read back by
 * walking its prototype chain. They share the framework's `ClassRef` rather than
 * spelling the constructor type per registry; this module exists so the ORM's own
 * modules import it from one place.
 */
import type { ClassRef as CoreClassRef } from "@zerotal/core";

/**
 * A model class used as a metadata key — the constructor, not an instance.
 *
 * This is the framework-wide `ClassRef` from `@zerotal/core`, re-exported because
 * every ORM signature that registers or reads per-class metadata takes one:
 * `registerColumn`, `registerRelation`, `columnsFor`, `relationsFor`,
 * `registerObserver` and the hook registry all key on it. Being `abstract` with
 * `never[]` constructor arguments, it accepts abstract bases and mixin-composed
 * classes alike, while rejecting the plain callbacks the old `Function` typing let
 * through.
 *
 * @internal Every ORM signature that takes one is itself `@internal`.
 */
export type ClassRef = CoreClassRef;
