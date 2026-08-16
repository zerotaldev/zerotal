/**
 * What a tab is.
 *
 * Every tab in the panel — built-in, channel, or plugin — is reduced to this, so
 * the shell has one loop for the tab strip and one call for the content instead
 * of a switch that grows a case per feature. Adding a tab is adding a file.
 */
import type { RequestTrace } from "../../RequestTrace.ts";
import type { Store } from "../state.ts";

export interface TabContext {
  /** The pinned or live trace, or null before any traffic. */
  trace: RequestTrace | null;
  store: Store;
  /**
   * The request-scoped views, for the list to render inside whichever request is
   * open. Absent in a test that renders one tab on its own.
   */
  sections?: TabView[];
}

/** The count beside a tab's label, and whether it should read as a warning. */
export interface TabBadge {
  count: number | string;
  warn?: boolean;
}

export interface TabView {
  id: string;
  label: string;
  /**
   * Whether this describes one request or the session.
   *
   * `"request"` is not a tab at all: it is a section of the request you opened
   * in the list. Twelve of these in the strip is twelve tabs that are empty for
   * most requests and answer a question you can only ask about a request you
   * have already picked — so they are rendered inside its row instead, and only
   * when they have something to say. `"session"` earns a tab, because it keeps
   * reading while you move between requests: the list itself, and a plugin that
   * owns live browser state.
   */
  scope: "request" | "session";
  /**
   * Show the live dot while connected. For the tab whose contents change on
   * their own rather than only when you pick a different request.
   */
  live?: boolean;
  /**
   * Redraw whenever anything in the store moved, not only when the selected
   * trace changed. The default is the cheaper one: a tab that reads one trace is
   * redrawn when that trace changes and left alone otherwise.
   */
  volatile?: boolean;
  /**
   * Render even when nothing is selected. Only the request list has anything to
   * say before the first request arrives.
   */
  standsAlone?: boolean;
  badge?(ctx: TabContext): TabBadge | undefined;
  render(host: HTMLElement, ctx: TabContext): void;
  /**
   * Redraw for a scroll of the content host, without a store change.
   *
   * Only a tab that windows its rows needs this — for everything else the
   * browser scrolls what is already drawn.
   */
  onScroll?(host: HTMLElement, ctx: TabContext): void;
}
