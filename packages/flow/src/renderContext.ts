import { AsyncLocalStorage } from "node:async_hooks";
import type { ChildMemo } from "./types.ts";

// ── Pending child descriptor ──────────────────────────────────────────────────

export interface PendingChild {
  placeholderId: string;
  /** The Component subclass to render. Typed loosely to avoid circular imports. */
  WidgetClass: { new (): unknown; name: string };
  props: Record<string, unknown>;
  key: string;
}

// ── Render context ────────────────────────────────────────────────────────────

export class RenderContext {
  readonly pending: PendingChild[] = [];
  private readonly _existingByKey: ReadonlyMap<string, ChildMemo>;

  constructor(existingChildren: ChildMemo[] = []) {
    this._existingByKey = new Map(existingChildren.map((c) => [c.key, c]));
  }

  getExisting(key: string): ChildMemo | undefined {
    return this._existingByKey.get(key);
  }

  registerChild(
    WidgetClass: { new (): unknown; name: string },
    props: Record<string, unknown>,
    key: string,
  ): string {
    const placeholderId = `__flow_child_${key}`;
    this.pending.push({ placeholderId, WidgetClass, props, key });
    return placeholderId;
  }
}

// ── AsyncLocalStorage store ───────────────────────────────────────────────────

const _als = new AsyncLocalStorage<RenderContext>();

export function createRenderContext(existingChildren?: ChildMemo[]): RenderContext {
  return new RenderContext(existingChildren);
}

/** Run `fn` with `ctx` as the active render context for the current async chain. */
export function runWithRenderContext<T>(ctx: RenderContext, fn: () => T): T {
  return _als.run(ctx, fn);
}

/** Returns the active render context, or undefined when called outside a render. */
export function getRenderContext(): RenderContext | undefined {
  return _als.getStore();
}
