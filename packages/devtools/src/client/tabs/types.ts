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
