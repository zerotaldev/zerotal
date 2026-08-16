/**
 * Everything the panel knows, in one place, with a change signal.
 *
 * It used to be sixteen `let`s inside `DevTools.start()` and a scattering of
 * `renderBar(); if (open) renderContent();` after each assignment — which meant
 * adding a piece of state meant finding every place that had to redraw because of
 * it, and forgetting one was a panel that showed something stale. Now a mutation
 * calls {@link Store.changed} and the shell decides what to redraw.
 */
import type { RequestTrace, TraceChannelDescriptor } from "../RequestTrace.ts";
import type { EditorName } from "../editor.ts";
import type { ClientMetric } from "./metrics.ts";
import { noFacets, traceMatches, type Facets } from "./filter.ts";
import type { ThemeChoice } from "./ui/theme.ts";

/**
 * How the panel turns a captured location into a link.
 *
 * Sent by the server rather than configured in the browser: the paths come from
 * the process that recorded them, so the process that recorded them is what
 * knows how to rewrite them.
 */
export interface EditorSettings {
  editor: EditorName | null;
  editorPathMap: Record<string, string>;
}

/**
 * The slice of state that outlives a reload.
 *
 * Which tab you were on, what you had filtered to, how tall you dragged the
 * panel, and whether it was open are answers to "where was I", and every reload
 * used to throw them away — which on a page you are reloading *because* you are
 * debugging it is the wrong moment to lose them.
 */
export interface PersistedUi {
  open: boolean;
  section: Section;
  tab: string;
  appTab: string;
  /** The view showing inside an open request. */
  sectionTab: string;
  filter: string;
  facets: Facets;
  height: number;
  theme: ThemeChoice;
}

/**
 * Which half of the panel is showing.
 *
 * `requests` is the trace stream — what the app just did. `app` is the framework
 * map — what the app *is*. Two sections rather than fifteen tabs in one strip:
 * they answer different questions, and a strip you have to scroll to reach the
 * routes list is one you stop reaching for.
 */
export type Section = "requests" | "app";

const UI_KEY = "__zerotal_devtools_ui";

/** Panel heights outside this range are a panel you cannot use. */
export const MIN_HEIGHT = 120;
export const DEFAULT_HEIGHT = 380;

function loadUi(): Partial<PersistedUi> {
  try {
    const raw = localStorage.getItem(UI_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Partial<PersistedUi>) : {};
  } catch {
    // Private mode, a disabled store, a half-written value — a dev panel that
    // cannot remember its tab is fine; one that throws on boot is not.
    return {};
  }
}

function saveUi(state: PersistedUi): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(state));
  } catch {
    /* see above */
  }
}

export class Store {
  // ── Server state ────────────────────────────────────────────────────────────
  traces: RequestTrace[] = [];
  channels: TraceChannelDescriptor[] = [];
  selected: RequestTrace | null = null;
  /** The request whose detail is open in the list, by trace id. */
  openTraceId: string | null = null;
  /**
   * Which view is showing inside the request you are reading.
   *
   * Kept across requests on purpose: someone comparing the queries of one
   * request against the next wants the queries again, not to be returned to the
   * top every time. Falls back to the first available when a request has nothing
   * to show under it.
   */
  sectionTab = "";
  connected = false;
  /**
   * How many traces to keep. Replaced by the server's real capacity when the
   * history frame lands; until then this matches the store's own default rather
   * than being a number of the client's own that a configured capacity could not
   * move.
   */
  capacity = 100;
  /** Replaced by the app's real settings when the history frame lands. */
  editor: EditorSettings = { editor: null, editorPathMap: {} };

  // ── Session state ───────────────────────────────────────────────────────────
  /** Following the newest request, rather than pinned to one you picked. */
  live = true;
  /** Traces that arrived while pinned — offered, never jumped to. */
  pending = 0;
  /** Correlated-request groups opened on the All tab. */
  readonly expanded = new Set<string>();
  /**
   * What the browser measured for this page load.
   *
   * Per page, not per request — which is why they sit above the waterfall
   * labelled as the browser's rather than being merged into it. A 12ms response
   * the browser spends 900ms painting is a slow page, and the server trace
   * cannot say so.
   */
  clientMetrics: ClientMetric[] = [];

  // ── Persisted UI ────────────────────────────────────────────────────────────
  open: boolean;
  section: Section;
  tab: string;
  /** The App section's tab, kept apart so switching sections restores each one. */
  appTab: string;
  filter: string;
  facets: Facets;
  height: number;
  theme: ThemeChoice;

  /**
   * Bumped on every change. A tab that must redraw whenever anything moved —
   * rather than only when the selected trace changed — reads this into its cache
   * key, which is how the All tab stays live while the others stay still.
   */
  revision = 0;

  private readonly listeners = new Set<() => void>();

  /**
   * @param standalone - The dashboard has nothing to collapse into; it starts open.
   * @param base - The devtools endpoint root, for the surfaces that fetch rather
   *   than listen. The App section reads the framework map over it.
   */
  constructor(
    standalone: boolean,
    readonly base = "/__zerotal/devtools",
  ) {
    const saved = loadUi();
    this.open = standalone || saved.open === true;
    this.section = saved.section === "app" ? "app" : "requests";
    // Live by default: the panel opens on the request you are looking at rather
    // than on a heading you then have to navigate away from. `queries` is no
    // longer a tab at all — a persisted one from before this change falls back to
    // the first, which is Live.
    this.tab = saved.tab === "queries" ? "live" : (saved.tab ?? "live");
    this.appTab = saved.appTab ?? "app:routes";
    this.sectionTab = saved.sectionTab ?? "";
    this.filter = saved.filter ?? "";
    this.facets = { ...noFacets(), ...(saved.facets ?? {}) };
    this.height = Math.max(MIN_HEIGHT, saved.height ?? DEFAULT_HEIGHT);
    this.theme = saved.theme ?? "auto";
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Announce a change. Every mutation ends here; nothing redraws without it. */
  changed(): void {
    this.revision++;
    for (const fn of this.listeners) fn();
  }

  /** Write the durable slice out. Called from the mutations that touch it. */
  persist(): void {
    saveUi({
      open: this.open,
      section: this.section,
      appTab: this.appTab,
      tab: this.tab,
      sectionTab: this.sectionTab,
      filter: this.filter,
      facets: this.facets,
      height: this.height,
      theme: this.theme,
    });
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  /**
   * The traces the All tab shows, with their index in the full list.
   *
   * The index rides along because a click has to select the right trace after
   * filtering, and because keyboard navigation steps through *this* list rather
   * than through everything recorded.
   */
  visible(): Array<{ trace: RequestTrace; index: number }> {
    const out: Array<{ trace: RequestTrace; index: number }> = [];
    this.traces.forEach((trace, index) => {
      if (traceMatches(trace, this.filter, this.facets)) out.push({ trace, index });
    });
    return out;
  }

  // ── Mutations ───────────────────────────────────────────────────────────────

  /** The tab showing in the current section. */
  get activeTab(): string {
    return this.section === "app" ? this.appTab : this.tab;
  }

  /** Pick the view showing inside the open request. */
  setSectionTab(id: string): void {
    if (this.sectionTab === id) return;
    this.sectionTab = id;
    this.persist();
    this.changed();
  }

  setTab(tab: string): void {
    const key = this.section === "app" ? "appTab" : "tab";
    if (this[key] === tab) return;
    this[key] = tab;
    this.persist();
    this.changed();
  }

  setSection(section: Section): void {
    if (this.section === section) return;
    this.section = section;
    this.persist();
    this.changed();
  }

  setFilter(filter: string): void {
    this.filter = filter;
    this.persist();
    this.changed();
  }

  setFacets(facets: Facets): void {
    this.facets = facets;
    this.persist();
    this.changed();
  }

  setHeight(height: number): void {
    this.height = Math.max(MIN_HEIGHT, Math.round(height));
    this.persist();
    this.changed();
  }

  setTheme(theme: ThemeChoice): void {
    this.theme = theme;
    this.persist();
    this.changed();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.persist();
    this.changed();
  }

  /** Pin a trace and stop following the newest. */
  select(trace: RequestTrace | null): void {
    this.selected = trace;
    this.live = false;
    this.pending = 0;
    this.persist();
    this.changed();
  }

  /**
   * Open a request's detail in the list, or close it if it is already open.
   *
   * Opening pins as well, because the detail and the status bar have to agree
   * about which request you are reading. One at a time: the detail is tall, and
   * two open at once is a list you cannot scan.
   */
  toggleOpen(trace: RequestTrace | null): void {
    if (!trace) return;
    this.openTraceId = this.openTraceId === trace.id ? null : trace.id;
    this.select(trace);
  }

  /** Follow the newest request again, clearing the backlog offer. */
  follow(): void {
    this.live = true;
    this.pending = 0;
    this.selected = this.traces[0] ?? null;
    this.changed();
  }

  pin(): void {
    this.live = false;
    this.changed();
  }

  toggleGroup(key: string): void {
    if (!this.expanded.delete(key)) this.expanded.add(key);
    this.changed();
  }

  /** Apply the stream's opening frame. */
  loadHistory(
    traces: RequestTrace[],
    channels: TraceChannelDescriptor[],
    capacity?: number,
    editor?: Partial<EditorSettings>,
  ): void {
    this.traces = traces;
    this.channels = channels;
    if (editor) this.editor = { ...this.editor, ...editor };
    // An older server sends no capacity; keeping what we have then is better than
    // trimming its history to a guess.
    if (typeof capacity === "number" && capacity > 0) this.capacity = capacity;
    if (this.live || !this.selected) this.selected = traces[0] ?? null;
    this.changed();
  }

  /** Take one new trace off the stream. */
  addTrace(trace: RequestTrace): void {
    this.traces.unshift(trace);
    if (this.traces.length > this.capacity) this.traces.length = this.capacity;
    if (this.live) this.selected = trace;
    else this.pending++;
    this.changed();
  }

  clear(): void {
    this.traces = [];
    this.selected = null;
    this.pending = 0;
    this.expanded.clear();
    this.changed();
  }
}
