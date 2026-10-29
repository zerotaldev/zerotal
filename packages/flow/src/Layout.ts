import type { HtmlNode } from "./jsx-runtime.ts";

/**
 * Base class for Flow page layouts — persistent shell UI wrapped around page content.
 *
 * @remarks
 * A layout wraps page content with shell UI (nav, sidebars, footers) that outlives page
 * navigation. On `flow:navigate`, pages that share the same layout class only swap the
 * page itself (its `[data-flow-root]`, or `[data-flow-page]` for a static page); the layout
 * shell stays mounted and is never re-rendered or
 * re-sent over the socket. Attach one with `static layout = AppLayout` on a {@link Component}
 * (or override {@link Component.layout} for the JSX-native form).
 *
 * @example
 * ```tsx
 * export class AppLayout extends Layout {
 *   static head = `<link rel="stylesheet" href="/app.css">`;
 *
 *   render(slot: HtmlNode) {
 *     return (
 *       <div>
 *         <nav>
 *           <a href="/dashboard" flow:navigate>Dashboard</a>
 *         </nav>
 *         <main>{slot}</main>
 *       </div>
 *     );
 *   }
 * }
 *
 * export class DashboardPage extends Component {
 *   static layout = AppLayout;
 * }
 * ```
 */
export abstract class Layout {
  /** Extra HTML injected into `<head>` (stylesheets, fonts, global meta tags). */
  static head?: string;

  /**
   * Render the layout shell around a page.
   *
   * @param slot  the page's pre-rendered node: its `[data-flow-root]` element, or a
   *   `[data-flow-page]` wrapper when the page is `static interactive = false`. Place it with
   *   `{slot}` in JSX — its HTML is emitted verbatim without escaping.
   * @returns the shell markup wrapping `slot`.
   */
  abstract render(slot: HtmlNode): HtmlNode | Promise<HtmlNode>;
}
