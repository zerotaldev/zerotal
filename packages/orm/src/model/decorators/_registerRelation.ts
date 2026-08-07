import type { RelationMetadata } from "../relations/RelationRegistry.ts";
import { enqueueMember, registerRelation } from "./_metadata.ts";

/**
 * The single plumbing for every relation field decorator (standard TC39 decorators).
 *
 * Registration is captured in the decorator BODY (which runs at definition time with the
 * correct `context.name`) and ENQUEUED — we can't use a field initializer/addInitializer,
 * which Bun 1.3.x cross-wires across classes in a file. The `@table` class decorator
 * drains the queue into the concrete class, invoking the relation FACTORY (`metaFor`)
 * with that class so morph/through values depending on the class name resolve correctly.
 */
export function makeRelationDecorator(
  metaFor: (ctor: Function, field: string) => RelationMetadata,
) {
  return function (_value: unknown, context: ClassFieldDecoratorContext): void {
    const name = String(context.name);
    enqueueMember(name, (ctor) => registerRelation(ctor, name, metaFor(ctor, name)));
  };
}
