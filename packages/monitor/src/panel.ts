/**
 * The monitor panel's contribution surface — how other packages add what *they*
 * want monitored.
 *
 * The monitor owns the shell, the time-range selector, the storage and the
 * retention policy; a package owns the knowledge of what is worth watching about
 * itself. So the monitor is a host: it publishes the write surface below, binds
 * it into the container as `monitor.panel`, and a package pushes a section into
 * it at boot:
 *
 *   // packages/scheduler/src/monitor.ts
 *   interface MonitorHost {                    // declared locally — no monitor dependency
 *     enabled(id: string): boolean;
 *     section(s: { id: string; label: string; resolve(range: string): unknown }): void;
 *   }
 *
 *   export function installSchedulerMonitor(app: Application): void {
 *     const monitor = app.container.tryMake("monitor.panel") as MonitorHost | undefined;
 *     if (!monitor?.enabled("scheduler")) return;
 *     monitor.section({ id: "scheduler", label: "Scheduled tasks", resolve });
 *   }
 *
 * A section is *described*, not rendered: the contributing package returns stats
 * and tables, and the monitor draws them. That keeps the panel coherent no matter
 * who contributed a section, and means a package needs no JSX and no dependency
 * on this one.
 *
 * This mirrors how the recorders already work. A satellite writes its measurements
 * into `monitor.store` through its own `observability.ts`; this is the other half —
 * saying what those measurements should look like on screen.
 */
import type { MonitorRange } from "./store/types.ts";

/** Semantic tone for a stat or cell — the panel maps it to its own palette. */
export type MonitorTone = "default" | "good" | "warn" | "bad";

/** A row in a contributed table. */
export type MonitorRow = Record<string, unknown>;

/** A headline figure at the top of a section. */
export interface MonitorStat {
  label: string;
  value: string | number;
  /** Secondary line under the value — a total, a rate, a comparison. */
  detail?: string;
  tone?: MonitorTone;
  /** Draw a 0–100 progress bar under the value. */
  percent?: number;
}

/** One column of a contributed table. */
export interface MonitorTableColumn {
  key: string;
  label: string;
  align?: "start" | "end";
  /** Render in a monospace face — ids, keys, class names. */
  mono?: boolean;
  /** Turn the raw value into display text. Defaults to `String(value)`. */
  format?: (value: unknown, row: MonitorRow) => string;
  /** Tint the cell. */
  tone?: (value: unknown, row: MonitorRow) => MonitorTone | null;
}

/** A table beneath a section's stats. */
export interface MonitorTable {
  title: string;
  columns: MonitorTableColumn[];
  rows: MonitorRow[];
  empty?: string;
}

/** What a section shows for the selected range. */
export interface MonitorSectionData {
  stats?: MonitorStat[];
  tables?: MonitorTable[];
}

/** A section contributed to the monitor's navigation. */
export interface MonitorSection {
  /** Stable id — the URL segment (`/monitor/<id>`) and the nav key. */
  id: string;
  label: string;
  /** Sidebar group heading. Contributed groups sort after the built-in ones. */
  group?: string;
  /** Raw SVG markup for the nav icon. Falls back to a generic glyph. */
  icon?: string;
  sort?: number;
  /**
   * Resolve the section's content for the selected time range.
   *
   * Called on every render and every auto-refresh, so it should read from
   * whatever the package already records rather than doing expensive work.
   */
  resolve(range: MonitorRange): Promise<MonitorSectionData> | MonitorSectionData;
}

/**
 * The monitor's write surface, bound into the container as `monitor.panel`.
 *
 * Contributors should declare their own minimal copy of the members they use
 * rather than importing this type, so they depend on this package not at all.
 */
export interface MonitorPanelHost {
  /**
   * Whether the app has left this contributor switched on. Check it first and
   * return early — `sections: { scheduler: false }` in `config/monitor.ts` turns
   * a contributor off without uninstalling its provider.
   */
  enabled(id: string): boolean;
  section(section: MonitorSection): void;
}

/** Registered contributed sections, in registration order. */
const _sections: MonitorSection[] = [];

/** Contributors the app has switched off, from `config/monitor.ts`. */
let _disabled: Record<string, boolean> = {};

/**
 * The monitor's contribution registry.
 *
 * Module-level rather than instance state because the panel is a single
 * process-wide product, matching how the store and config are published.
 */
export const MonitorPanel = {
  /** Record which contributors the app disabled. Called by the provider on boot. */
  configure(sections: Record<string, boolean> | undefined): void {
    _disabled = sections ?? {};
  },

  /** The write surface handed to contributors through the container. */
  host(): MonitorPanelHost {
    return {
      enabled: (id) => _disabled[id] !== false,
      section: (section) => {
        if (_sections.some((s) => s.id === section.id)) return;
        _sections.push(section);
      },
    };
  },

  /** Every contributed section, sorted for display. */
  sections(): MonitorSection[] {
    return [..._sections].sort(
      (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.label.localeCompare(b.label),
    );
  },

  /** Resolve a contributed section by id. */
  find(id: string): MonitorSection | undefined {
    return _sections.find((s) => s.id === id);
  },

  /** Reset the registry (tests). */
  reset(): void {
    _sections.length = 0;
    _disabled = {};
  },
};
