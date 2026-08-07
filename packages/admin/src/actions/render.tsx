/** @jsxImportSource @zerotal/flow */
// Render an Action as a themed link (navigate) or server-action button (with an
// optional `confirm` dialog). Shared by row actions, header actions, and the
// bulk toolbar so every action looks and behaves consistently.

import type { HtmlNode } from "@zerotal/flow";
import { DropdownMenu } from "@zerotal/flow-ui";
import { Icon } from "../ui/icons.tsx";
import type { Action, ActionColor, ActionContext, ActionGroup } from "./Action.ts";

const COLOR: Record<ActionColor, string> = {
  default:
    "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
  success: "border-input bg-background text-success hover:bg-success/10 hover:border-success/40",
  muted: "border-input bg-background text-muted-foreground hover:bg-accent",
  destructive:
    "border-input bg-background text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive",
};

export interface RenderActionOptions {
  /** The page's @expose handler invoked for callback actions. */
  onRun?: unknown;
  /** The page's @expose handler invoked for actions with a modal form (opens it). */
  onForm?: unknown;
  /** Args serialized into `data-args` for the handler (e.g. [key, id]). */
  args?: unknown[];
}

/** Render a single action. Link actions become `<a navigate>`, callbacks `<button>`. */
export function renderAction(
  a: Action,
  ctx: ActionContext,
  opts: RenderActionOptions = {},
): HtmlNode | null {
  if (!a.isVisibleFor(ctx.record, ctx)) return null;

  const colorCls = COLOR[a._color];
  const cls = a._iconOnly
    ? `inline-flex h-8 w-8 items-center justify-center rounded-md border transition ${colorCls}`
    : `inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${colorCls}`;

  const inner = (
    <>
      {a._icon ? <Icon name={a._icon} class="h-4 w-4" /> : null}
      {a._iconOnly ? null : <span>{a.getLabel()}</span>}
    </>
  );

  // Modal-form action: open the dialog (no confirm — the modal is the confirm).
  if (a.hasForm() && opts.onForm) {
    return (
      <button
        type="button"
        onClick={opts.onForm}
        data-args={JSON.stringify(opts.args ?? [])}
        title={a.getLabel()}
        class={cls}
      >
        {inner}
      </button>
    );
  }

  if (a.isLink()) {
    const href = a.href(ctx) ?? "#";
    return (
      <a href={href} navigate title={a.getLabel()} class={cls}>
        {inner}
      </a>
    );
  }

  // Callback action: server method + optional confirm dialog.
  return (
    <button
      type="button"
      onClick={opts.onRun}
      data-args={JSON.stringify(opts.args ?? [])}
      {...(a._confirm ? { confirm: a._confirm } : {})}
      title={a.getLabel()}
      class={cls}
    >
      {inner}
    </button>
  );
}

/**
 * Render a group as one trigger opening a menu of its members.
 *
 * Returns `null` when nothing inside is visible, so an empty menu never appears.
 * `argsFor` builds each member's handler arguments, since those carry the
 * action's own key.
 */
export function renderActionGroup(
  group: ActionGroup,
  ctx: ActionContext,
  opts: RenderActionOptions & { argsFor?: (a: Action) => unknown[] } = {},
): HtmlNode | null {
  const members = group.visibleActions(ctx.record, ctx);
  if (members.length === 0) return null;

  return (
    <DropdownMenu
      align="right"
      trigger={
        <button
          type="button"
          title={group.getLabel()}
          class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
        >
          <Icon name={group._icon} class="h-4 w-4" />
        </button>
      }
    >
      {members.map((a) => {
        const args = opts.argsFor ? opts.argsFor(a) : opts.args;
        return renderActionMenuItem(a, ctx, {
          ...opts,
          ...(args === undefined ? {} : { args }),
        });
      })}
    </DropdownMenu>
  );
}

/**
 * Render an action as a full-width dropdown menu row (icon + label). Used by the
 * row-action overflow menu when a row has more actions than fit inline.
 */
export function renderActionMenuItem(
  a: Action,
  ctx: ActionContext,
  opts: RenderActionOptions = {},
): HtmlNode | null {
  if (!a.isVisibleFor(ctx.record, ctx)) return null;

  const tone =
    a._color === "destructive"
      ? "text-destructive hover:bg-destructive/10"
      : "hover:bg-accent hover:text-accent-foreground";
  const cls = `flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors ${tone}`;
  const inner = (
    <>
      {a._icon ? <Icon name={a._icon} class="h-4 w-4" /> : null}
      <span>{a.getLabel()}</span>
    </>
  );

  if (a.hasForm() && opts.onForm) {
    return (
      <button
        type="button"
        onClick={opts.onForm}
        data-args={JSON.stringify(opts.args ?? [])}
        class={cls}
      >
        {inner}
      </button>
    );
  }
  if (a.isLink()) {
    return (
      <a href={a.href(ctx) ?? "#"} navigate class={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={opts.onRun}
      data-args={JSON.stringify(opts.args ?? [])}
      {...(a._confirm ? { confirm: a._confirm } : {})}
      class={cls}
    >
      {inner}
    </button>
  );
}
