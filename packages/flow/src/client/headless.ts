// ── Headless client runtime ─────────────────────────────────────────────────
//
// Alpine.data() factories for the keyboard/ARIA-rich headless primitives
// (RadioGroup, Listbox). Registered into Alpine by the client entry, alongside
// the $flow magic. Selection reads/writes component state via $flow, so values stay
// in sync with the server and submit like any field. Highlight (`active`) and
// open/close are local Alpine state — instant, no round-trip.
//
// The factories are exported standalone so the selection/keyboard logic is
// unit-testable with a mocked $flow / $el.

type FlowMagic = { $get(prop: string): unknown; $set(prop: string, value: unknown): void };

/** Parse an option element's data-value back to its original JSON value. */
function optValue(el: Element): unknown {
  const raw = el.getAttribute("data-value");
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// ── RadioGroup ────────────────────────────────────────────────────────────────
// Templates read selection via `$flow.<name> === value` directly (stays in sync
// with the server); this factory supplies `select()` and arrow-key roving.

export function flowRadioGroup(config: { name: string }) {
  return {
    name: config.name,
    _radios(this: any): HTMLElement[] {
      return Array.from(this.$el.querySelectorAll('[role="radio"]'));
    },
    select(this: any, v: unknown) {
      this.$flow.$set(this.name, v);
    },
    onKey(this: any, e: KeyboardEvent) {
      const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
      const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
      if (!fwd && !back) return;
      e.preventDefault();
      const radios = this._radios();
      if (!radios.length) return;
      const i = radios.indexOf(e.target as HTMLElement);
      const next = radios[(i + (fwd ? 1 : radios.length - 1) + radios.length) % radios.length];
      if (next) {
        next.focus();
        next.click();
      }
    },
  };
}

// ── Listbox ─────────────────────────────────────────────────────────────────
// Local `open` + `active` (highlight) state; selection round-trips through $flow.
// Templates bind data-active / aria-selected reactively off `active` and
// `isSelected()`, so this factory never touches the DOM for styling.

export function flowListbox(config: { name: string; multiple?: boolean }) {
  return {
    name: config.name,
    multiple: !!config.multiple,
    open: false,
    active: -1,

    _options(this: any): HTMLElement[] {
      return Array.from(this.$el.querySelectorAll('[role="option"]'));
    },

    isSelected(this: any, v: unknown): boolean {
      const cur = (this.$flow as FlowMagic).$get(this.name);
      return this.multiple ? Array.isArray(cur) && cur.includes(v) : cur === v;
    },

    toggle(this: any) {
      if (this.open) this.close();
      else this.openList();
    },

    openList(this: any) {
      this.open = true;
      const opts = this._options();
      const i = opts.findIndex((o: Element) => this.isSelected(optValue(o)));
      this.active = i >= 0 ? i : 0;
    },

    close(this: any) {
      this.open = false;
      this.active = -1;
      (this.$el.querySelector("button") as HTMLElement | null)?.focus();
    },

    move(this: any, delta: number) {
      const n = this._options().length;
      if (!n) return;
      this.active = (this.active + delta + n) % n;
    },

    select(this: any, v: unknown) {
      const flow = this.$flow as FlowMagic;
      if (this.multiple) {
        const cur = flow.$get(this.name);
        const arr = Array.isArray(cur) ? [...cur] : [];
        const idx = arr.indexOf(v);
        if (idx === -1) arr.push(v);
        else arr.splice(idx, 1);
        flow.$set(this.name, arr);
      } else {
        flow.$set(this.name, v);
        this.close();
      }
    },

    onButtonKey(this: any, e: KeyboardEvent) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.openList();
      }
    },

    onKey(this: any, e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          this.move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          this.move(-1);
          break;
        case "Home":
          e.preventDefault();
          this.active = 0;
          break;
        case "End":
          e.preventDefault();
          this.active = this._options().length - 1;
          break;
        case "Enter":
        case " ": {
          e.preventDefault();
          const o = this._options()[this.active];
          if (o) this.select(optValue(o));
          break;
        }
        case "Escape":
          e.preventDefault();
          this.close();
          break;
        case "Tab":
          this.close();
          break;
      }
    },
  };
}

// ── Combobox ──────────────────────────────────────────────────────────────────
// Server mode: the input uses flow:model.live, so every keystroke syncs the query
// prop and the server re-renders the already-filtered options. `open` survives
// Alpine morph patches so the list stays visible while the user types.
// Client mode: options have x-show filters driven by the local `query` string.

export function flowCombobox(config: { name: string; queryName?: string | null; query?: string }) {
  return {
    name: config.name,
    queryName: config.queryName ?? null,
    open: false,
    active: -1,
    query: config.query ?? "",

    _options(this: any): HTMLElement[] {
      return Array.from(this.$el?.querySelectorAll('[role="option"]') ?? []);
    },

    isSelected(this: any, v: unknown): boolean {
      return (this.$flow as FlowMagic).$get(this.name) === v;
    },

    openList(this: any) {
      this.open = true;
      const opts = this._options();
      const cur = (this.$flow as FlowMagic).$get(this.name);
      const i = opts.findIndex((o: Element) => {
        const raw = o.getAttribute("data-value");
        try {
          return raw !== null && JSON.parse(raw) === cur;
        } catch {
          return raw === cur;
        }
      });
      this.active = i >= 0 ? i : opts.length ? 0 : -1;
    },

    close(this: any) {
      this.open = false;
      this.active = -1;
      this.$el?.querySelector("input")?.focus();
    },

    // select(value, label) — called directly (keyboard Enter) or from selectEl.
    select(this: any, v: unknown, label: string) {
      (this.$flow as FlowMagic).$set(this.name, v);
      if (this.queryName) {
        (this.$flow as FlowMagic).$set(this.queryName, label);
      } else {
        this.query = label;
      }
      this.close();
    },

    selectEl(this: any, el: HTMLElement) {
      const raw = el.getAttribute("data-value");
      let v: unknown;
      try {
        v = JSON.parse(raw ?? "");
      } catch {
        v = raw;
      }
      this.select(v, el.getAttribute("data-label") ?? "");
    },

    onInput(this: any, e: InputEvent) {
      if (!this.open) this.open = true;
      if (!this.queryName) {
        this.query = (e.target as HTMLInputElement).value;
      }
    },

    move(this: any, delta: number) {
      const all = this._options() as Array<{ style?: { display: string } }>;
      const visible = all.filter((o) => (o as any).style?.display !== "none");
      if (!visible.length) return;
      const cur = all[this.active];
      const visIdx = visible.indexOf(cur as any);
      const start = visIdx >= 0 ? visIdx : 0;
      const next = visible[(start + delta + visible.length) % visible.length];
      this.active = all.indexOf(next as any);
    },

    onKey(this: any, e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (!this.open) this.openList();
          else this.move(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (!this.open) this.openList();
          else this.move(-1);
          break;
        case "Enter": {
          e.preventDefault();
          const o = this._options()[this.active];
          if (o) this.selectEl(o);
          break;
        }
        case "Escape":
          e.preventDefault();
          this.close();
          break;
        case "Tab":
          this.close();
          break;
      }
    },
  };
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
// Roving tabindex + arrow-key navigation for the <Tabs> component. Tracks the
// active tab name (`tab`); the template uses `x-on:click="tab = '<name>'"` to
// select; this factory only handles keyboard navigation on the tablist.

export function flowTabs(config: { tab: string }) {
  return {
    tab: config.tab,
    _tabs(this: any): HTMLElement[] {
      return Array.from(this.$el.querySelectorAll('[role="tab"]'));
    },
    onKey(this: any, e: KeyboardEvent) {
      const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!fwd && !back) return;
      e.preventDefault();
      const tabs = this._tabs();
      if (!tabs.length) return;
      const i = tabs.indexOf(e.target as HTMLElement);
      const next = tabs[(i + (fwd ? 1 : tabs.length - 1) + tabs.length) % tabs.length];
      if (next) {
        next.focus();
        next.click();
      }
    },
  };
}

// ── Menu (Dropdown) ────────────────────────────────────────────────────────────
// ARIA menu keyboard navigation for <Dropdown>. Arrow keys / Home / End move
// focus through items; Escape closes and returns focus to the trigger. A click
// outside or Escape-from-window closes without stealing focus.

export function flowMenu() {
  // Non-reactive closure vars so neither openMenu's $nextTick nor the $watch
  // callback reads/writes reactive state — preventing spurious re-focus after
  // ArrowDown moves focus to the next item.
  let _pendingLast = false;
  let _activeItem: HTMLElement | null = null;

  return {
    open: false,

    init(this: any) {
      // $watch fires after Alpine has processed x-show, so the panel is visible
      // and focus() actually lands on the element.
      this.$watch("open", (value: boolean) => {
        if (!value) {
          _activeItem = null;
          return;
        }
        const last = _pendingLast;
        this.$nextTick(() => {
          const items = this._items();
          if (!items.length) return;
          const target = (last ? items[items.length - 1] : items[0]) as HTMLElement;
          target?.focus();
          _activeItem = target;
        });
      });
    },

    _items(this: any): HTMLElement[] {
      // In Alpine v3, $el inside x-on:keydown on the panel is the panel itself,
      // not the x-data root. Use closest() to always find the component root.
      const el = this.$el as HTMLElement;
      const root =
        typeof el.closest === "function" ? ((el.closest("[x-data]") as HTMLElement) ?? el) : el;
      const menu = root.querySelector('[role="menu"]');
      if (!menu) return [];
      return Array.from(
        menu.querySelectorAll(
          '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],button:not([disabled]),a[href]',
        ),
      );
    },

    _trigger(this: any): HTMLElement | null {
      const el = this.$el as HTMLElement;
      const root =
        typeof el.closest === "function" ? ((el.closest("[x-data]") as HTMLElement) ?? el) : el;
      return root.querySelector("[aria-haspopup]");
    },

    openMenu(this: any, last = false) {
      _pendingLast = last;
      this.open = true;
      // Unit tests provide a synchronous $nextTick mock and never call init(),
      // so the $watch branch doesn't run — this path handles them.
      this.$nextTick(() => {
        const items = this._items();
        if (!items.length) return;
        const target = (last ? items[items.length - 1] : items[0]) as HTMLElement;
        target?.focus();
        _activeItem = target;
      });
    },

    close(this: any, refocus = true) {
      this.open = false;
      _activeItem = null;
      if (refocus) this._trigger()?.focus();
    },

    toggle(this: any) {
      if (this.open) this.close();
      else this.openMenu(false);
    },

    onButtonKey(this: any, e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.openMenu(false);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.openMenu(true);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.openMenu(false);
      }
    },

    onKey(this: any, e: KeyboardEvent) {
      const items = this._items();
      // Prefer _activeItem (set when focus last moved within the menu) over
      // document.activeElement, which can drift if focus is temporarily stolen.
      const cur =
        (_activeItem as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
      const i = cur ? items.indexOf(cur) : -1;
      const n = items.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          _activeItem = items[(i + 1 + n) % n] ?? null;
          _activeItem?.focus();
          break;
        case "ArrowUp":
          e.preventDefault();
          _activeItem = items[(i - 1 + n) % n] ?? null;
          _activeItem?.focus();
          break;
        case "Home":
          e.preventDefault();
          _activeItem = items[0] ?? null;
          _activeItem?.focus();
          break;
        case "End":
          e.preventDefault();
          _activeItem = items[n - 1] ?? null;
          _activeItem?.focus();
          break;
        case "Escape":
          e.preventDefault();
          this.close(true);
          break;
        case "Tab":
          this.close(false);
          break;
      }
    },
  };
}

// ── Field ─────────────────────────────────────────────────────────────────────
// Wires ARIA for <Field>: assigns IDs, sets label[for], aria-describedby, and
// aria-invalid. A MutationObserver keeps aria-invalid in sync as the error text
// changes during validation (Alpine morph patches the element in place).

let _fieldCounter = 0;

export function flowField() {
  return {
    _observer: null as MutationObserver | null,

    init(this: any) {
      const root = this.$el;
      const n = ++_fieldCounter;

      const control = root.querySelector("input, select, textarea, button");
      if (!control) return;
      if (!control.id) control.id = `flow-field-${n}`;

      const label = root.querySelector("label");
      if (label) label.setAttribute("for", control.id);

      const described: string[] = [];

      const desc = root.querySelector("[data-flow-description]");
      if (desc) {
        if (!desc.id) desc.id = `flow-field-desc-${n}`;
        described.push(desc.id);
      }

      const err = root.querySelector(".flow-field-error");
      if (err) {
        if (!err.id) err.id = `flow-field-err-${n}`;
        described.push(err.id);
        const updateInvalid = () => {
          control.setAttribute("aria-invalid", err.textContent?.trim() ? "true" : "false");
        };
        updateInvalid();
        if (typeof MutationObserver !== "undefined") {
          this._observer = new MutationObserver(updateInvalid);
          this._observer.observe(err, { childList: true, characterData: true, subtree: true });
        }
      } else {
        control.setAttribute("aria-invalid", "false");
      }

      if (described.length) control.setAttribute("aria-describedby", described.join(" "));
    },

    destroy(this: any) {
      this._observer?.disconnect();
      this._observer = null;
    },
  };
}

// ── FileUpload ────────────────────────────────────────────────────────────────
// Tracks upload lifecycle events dispatched by the Flow upload handler.
// Filters by `name` so multiple file fields on the same page stay independent.

export function flowFileUpload(config: { name: string }) {
  return {
    name: config.name,
    uploading: false,
    progress: 0,
    error: "",
    _handlers: [] as Array<[string, EventListener]>,

    init(this: any) {
      const on = (event: string, handler: EventListener) => {
        window.addEventListener(event, handler);
        this._handlers.push([event, handler]);
      };

      on("flow:upload-start", ((e: CustomEvent) => {
        if (e.detail.key !== this.name) return;
        this.uploading = true;
        this.error = "";
      }) as EventListener);

      on("flow:upload-progress", ((e: CustomEvent) => {
        if (e.detail.key !== this.name) return;
        this.progress = e.detail.percent;
      }) as EventListener);

      on("flow:upload-error", ((e: CustomEvent) => {
        if (e.detail.key !== this.name) return;
        this.uploading = false;
        this.error = e.detail.error ?? "Upload failed";
      }) as EventListener);

      // `-finish`, not `-done`. The bridge dispatches `flow:upload-finish`
      // (`_uploadFiles`) and the guide documents that name; this listener was the
      // only place `flow:upload-done` appeared, and nothing has ever dispatched
      // it. So the success path never ran: `uploading` stayed true after a
      // perfectly good upload and the dropzone read "Uploading… 100%" forever,
      // while the file itself had already been stored and bound.
      on("flow:upload-finish", ((e: CustomEvent) => {
        if (e.detail.key !== this.name) return;
        this.uploading = false;
        this.progress = 100;
      }) as EventListener);
    },

    destroy(this: any) {
      for (const [event, handler] of this._handlers) {
        window.removeEventListener(event, handler);
      }
      this._handlers = [];
    },
  };
}

/**
 * What Alpine injects into a `data()` factory's methods.
 *
 * Typed once and applied with `this:` so the newer factories keep their `$flow`
 * and `$refs` access checked, rather than each method opting out with `any`.
 */
interface AlpineCtx {
  $flow?: Partial<FlowMagic>;
  $el: HTMLElement;
  $refs: Record<string, HTMLElement | undefined>;
  $nextTick(fn: () => void): void;
}

/** The reactive state each factory owns, so `this` stays checked inside them. */
interface SliderState {
  value: number;
  dragging: boolean;
  percent(): number;
  onInput(event: Event): void;
  commit(): void;
}

interface ToggleGroupState {
  selected: string[];
  isOn(value: string): boolean;
  toggle(value: string): void;
}

interface CalendarState {
  month: string;
  value: string;
  today: string;
  shift(by: number): void;
  cells(): { day: string; inMonth: boolean }[];
  isDisabled(day: string): boolean;
  select(day: string): void;
  label(): string;
  dayNumber(day: string): string;
}

interface ChartState {
  hover: number;
  tipX: number;
  ready: boolean;
  onMove(event: PointerEvent): void;
  onLeave(): void;
  tip(): FlowChartPoint | null;
}

interface CommandState {
  open: boolean;
  query: string;
  active: number;
  _hotkey?: (event: KeyboardEvent) => void;
  results(): FlowCommandItem[];
  startsGroup(index: number): boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  move(by: number): void;
  choose(index?: number): void;
}

// ── Slider ────────────────────────────────────────────────────────────────────
// The value is local Alpine state so the thumb and the readout track the pointer
// at frame rate; `$flow` is told once the drag ends. Syncing on every pointermove
// would put a network round-trip between the finger and the pixel, which is
// exactly the lag a slider makes visible.

export function flowSlider(config: { name?: string; min: number; max: number; step: number }) {
  return {
    value: 0,
    dragging: false,
    init(this: AlpineCtx & SliderState) {
      // Seeded from the server's value, so the first paint is already right.
      const initial = config.name ? this.$flow?.$get?.(config.name) : undefined;
      this.value = Number(initial ?? this.$el.querySelector("input")?.value ?? config.min);
    },
    /** Percentage along the track, for the fill and the readout. */
    percent(this: AlpineCtx & SliderState): number {
      const span = config.max - config.min || 1;
      return Math.min(100, Math.max(0, ((this.value - config.min) / span) * 100));
    },
    /** Every input event — local only, so dragging stays smooth. */
    onInput(this: AlpineCtx & SliderState, event: Event) {
      this.dragging = true;
      this.value = Number((event.target as HTMLInputElement).value);
    },
    /** The drag or keypress settling — the one moment the server hears about. */
    commit(this: AlpineCtx & SliderState) {
      this.dragging = false;
      if (config.name) this.$flow?.$set?.(config.name, this.value);
    },
  };
}

// ── Toggle group ──────────────────────────────────────────────────────────────
// Pressing is local state first and a `$flow` write second, so the button reacts
// on click rather than after a round-trip. A toggle that waits for the server
// before it looks pressed feels broken even when the server is fast.

export function flowToggleGroup(config: { name?: string; multiple?: boolean }) {
  return {
    selected: [] as string[],
    init(this: AlpineCtx & ToggleGroupState) {
      const initial = config.name ? this.$flow?.$get?.(config.name) : undefined;
      this.selected = Array.isArray(initial) ? [...initial] : initial ? [String(initial)] : [];
    },
    isOn(this: AlpineCtx & ToggleGroupState, value: string): boolean {
      return this.selected.includes(value);
    },
    toggle(this: AlpineCtx & ToggleGroupState, value: string) {
      if (config.multiple) {
        this.selected = this.isOn(value)
          ? this.selected.filter((v: string) => v !== value)
          : [...this.selected, value];
      } else {
        // A single-choice group deselects on a second press, which is what makes
        // it a filter rather than a radio set you can never clear.
        this.selected = this.isOn(value) ? [] : [value];
      }
      if (config.name) {
        this.$flow?.$set?.(
          config.name,
          config.multiple ? this.selected : (this.selected[0] ?? null),
        );
      }
    },
  };
}

// ── Calendar ──────────────────────────────────────────────────────────────────
// Month paging and day selection are entirely local: the grid for any month is
// arithmetic the browser can already do, so asking the server for it means a
// round-trip to answer a question that needs no data. `$flow` hears only the
// chosen day.

/** `YYYY-MM-DD` for a local date — never `toISOString`, which shifts to UTC. */
function localDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function flowCalendar(config: {
  name?: string;
  month: string;
  sundayFirst?: boolean;
  min?: string;
  max?: string;
}) {
  return {
    month: config.month,
    value: "",
    today: localDay(new Date()),
    init(this: AlpineCtx & CalendarState) {
      const initial = config.name ? this.$flow?.$get?.(config.name) : undefined;
      if (typeof initial === "string" && initial) {
        this.value = initial;
        this.month = initial.slice(0, 7);
      }
    },
    /** Step the month, wrapping the year. */
    shift(this: AlpineCtx & CalendarState, by: number) {
      const [y = 1970, m = 1] = this.month.split("-").map(Number);
      const date = new Date(y, m - 1 + by, 1);
      this.month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    },
    /** Six weeks of cells, so the grid never changes height between months. */
    cells(this: AlpineCtx & CalendarState): { day: string; inMonth: boolean }[] {
      const [y = 1970, m = 1] = this.month.split("-").map(Number);
      const first = new Date(y, m - 1, 1);
      const weekday = config.sundayFirst ? first.getDay() : (first.getDay() + 6) % 7;
      const start = new Date(first);
      start.setDate(first.getDate() - weekday);

      const out: { day: string; inMonth: boolean }[] = [];
      for (let i = 0; i < 42; i++) {
        const date = new Date(start);
        date.setDate(start.getDate() + i);
        out.push({ day: localDay(date), inMonth: date.getMonth() === m - 1 });
      }
      return out;
    },
    isDisabled(this: AlpineCtx & CalendarState, day: string): boolean {
      return Boolean((config.min && day < config.min) || (config.max && day > config.max));
    },
    select(this: AlpineCtx & CalendarState, day: string) {
      if (this.isDisabled(day)) return;
      this.value = day;
      if (config.name) this.$flow?.$set?.(config.name, day);
    },
    label(this: AlpineCtx & CalendarState): string {
      const [y = 1970, m = 1] = this.month.split("-").map(Number);
      return `${MONTH_NAMES[m - 1]} ${y}`;
    },
    dayNumber(this: AlpineCtx & CalendarState, day: string): string {
      return String(Number(day.slice(-2)));
    },
  };
}

// ── Chart ─────────────────────────────────────────────────────────────────────
// The SVG geometry is rendered on the server, so a chart is in the HTML on first
// paint with no library to download. This factory adds only what genuinely needs
// a pointer: a tooltip that follows the cursor, and a draw-in on mount.
//
// Keeping the geometry server-side and the interaction client-side is the
// deliberate split — the browser never recomputes what the markup already says.

export interface FlowChartPoint {
  x: number;
  label: string;
  values: { label: string; value: string; color: string }[];
}

export function flowChart(config: { points: FlowChartPoint[] }) {
  return {
    hover: -1,
    tipX: 0,
    ready: false,
    init(this: AlpineCtx & ChartState) {
      // Next frame, so the transition has a state to animate away from.
      requestAnimationFrame(() => {
        this.ready = true;
      });
    },
    /** Nearest data point to the pointer, in the element's own coordinate space. */
    onMove(this: AlpineCtx & ChartState, event: PointerEvent) {
      const box = this.$el.getBoundingClientRect();
      if (!box.width || !config.points.length) return;
      const ratio = (event.clientX - box.left) / box.width;

      let best = 0;
      let bestGap = Infinity;
      for (let i = 0; i < config.points.length; i++) {
        const gap = Math.abs(config.points[i]!.x - ratio);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      }
      this.hover = best;
      this.tipX = config.points[best]!.x * box.width;
    },
    onLeave(this: AlpineCtx & ChartState) {
      this.hover = -1;
    },
    tip(this: AlpineCtx & ChartState) {
      return this.hover < 0 ? null : config.points[this.hover];
    },
  };
}

// ── Command menu ──────────────────────────────────────────────────────────────
// Filtering, ranking and keyboard navigation all run locally. A palette that
// waits for the network between keystrokes is worse than no palette — the whole
// promise is that it keeps up with typing — so the items ship once and every
// keystroke is answered from memory.
//
// That puts a practical ceiling on how many items belong here: a few hundred
// destinations is fine, a table of ten thousand records wants a search page with
// a server query behind it.

/**
 * Subsequence match with a score.
 *
 * Earlier matches and adjacent characters rank higher, so "prod" prefers
 * "Products" over "Pending Orders" — the behaviour an editor's fuzzy-open has
 * trained everyone to expect. A negative score means no match at all.
 */
export function flowCommandScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  let ni = 0;
  let score = 0;
  let streak = 0;
  while (hi < h.length && ni < n.length) {
    if (h[hi] === n[ni]) {
      streak++;
      score += 10 + streak * 5 - Math.min(hi, 20);
      ni++;
    } else {
      streak = 0;
    }
    hi++;
  }
  return ni === n.length ? score : -1;
}

export interface FlowCommandItem {
  label: string;
  href?: string;
  action?: string;
  group?: string;
  keywords?: string;
  shortcut?: string;
}

export function flowCommand(config: { items: FlowCommandItem[]; hotkey?: string | null }) {
  return {
    open: false,
    query: "",
    active: 0,
    init(this: AlpineCtx & CommandState) {
      if (!config.hotkey) return;
      this._hotkey = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === config.hotkey) {
          event.preventDefault();
          this.toggle();
        }
      };
      window.addEventListener("keydown", this._hotkey);
    },
    destroy(this: AlpineCtx & CommandState) {
      if (this._hotkey) window.removeEventListener("keydown", this._hotkey);
    },
    /** Matching items, best first. Recomputed per keystroke — cheap at this size. */
    results(this: AlpineCtx & CommandState): FlowCommandItem[] {
      const q = this.query.trim();
      return config.items
        .map((item, i) => {
          const hay = `${item.label} ${item.keywords ?? ""} ${item.group ?? ""}`;
          return { item, score: q ? flowCommandScore(hay, q) : 1000 - i };
        })
        .filter((r) => r.score >= 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => r.item);
    },
    /** Whether this row starts a new group, so the heading renders once. */
    startsGroup(this: AlpineCtx & CommandState, index: number): boolean {
      const rows = this.results();
      const group = rows[index]?.group;
      return Boolean(group) && (index === 0 || rows[index - 1]?.group !== group);
    },
    show(this: AlpineCtx & CommandState) {
      this.open = true;
      this.query = "";
      this.active = 0;
      this.$nextTick(() => this.$refs.field?.focus());
    },
    hide(this: AlpineCtx & CommandState) {
      this.open = false;
    },
    toggle(this: AlpineCtx & CommandState) {
      if (this.open) this.hide();
      else this.show();
    },
    move(this: AlpineCtx & CommandState, by: number) {
      const total = this.results().length;
      if (!total) return;
      this.active = Math.min(total - 1, Math.max(0, this.active + by));
    },
    choose(this: AlpineCtx & CommandState, index?: number) {
      const item = this.results()[index ?? this.active];
      if (!item) return;
      this.hide();
      if (item.action) {
        window.dispatchEvent(
          new CustomEvent("flow:invoke", { detail: { expression: item.action } }),
        );
      } else if (item.href) {
        // Uses the client router when one is present, so the palette navigates
        // the way a link does rather than reloading the page.
        const nav = (window as any).Flow?.navigate;
        if (nav) nav(item.href);
        else window.location.href = item.href;
      }
    },
  };
}

// ── registerHeadless ──────────────────────────────────────────────────────────
// Called by the client bundle entry to wire all factories into Alpine.data().

type AlpineInstance = { data(name: string, factory: (config: any) => object): void };

export function registerHeadless(Alpine: AlpineInstance): void {
  Alpine.data("flowRadioGroup", flowRadioGroup as any);
  Alpine.data("flowListbox", flowListbox as any);
  Alpine.data("flowCombobox", flowCombobox as any);
  Alpine.data("flowTabs", flowTabs as any);
  Alpine.data("flowMenu", flowMenu as any);
  Alpine.data("flowField", flowField as any);
  Alpine.data("flowFileUpload", flowFileUpload as any);
  Alpine.data("flowSlider", flowSlider as any);
  Alpine.data("flowToggleGroup", flowToggleGroup as any);
  Alpine.data("flowCalendar", flowCalendar as any);
  Alpine.data("flowChart", flowChart as any);
  Alpine.data("flowCommand", flowCommand as any);
}
