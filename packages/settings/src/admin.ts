/**
 * Settings → admin panel: a generated settings screen.
 *
 * Every declared setting is a row, with its value at the level the panel is
 * looking at — the tenant's, inside a tenant, otherwise the app-wide one — where
 * it came from, and actions to change it, hide the override (keeping it), or
 * unhide it. Nothing is written by hand: a new `defineSettings()` key is a new row.
 *
 * As with the queue's console, the panel is resolved from the container and typed
 * through a local interface, so settings does not depend on `@zerotal/admin` and
 * an app without the panel pulls in nothing.
 */
import type { Application } from "@zerotal/core";
import { TenantContext } from "@zerotal/tenancy";
import { _optionalService } from "./container.ts";
import type { SettingDefinition } from "./setting.ts";
import type { SettingsManager } from "./SettingsManager.ts";

type Row = Record<string, unknown>;
type Tone = "primary" | "success" | "muted" | "destructive" | "default";

/** The slice of the admin panel's contribution surface this module uses. */
interface AdminPanelSink {
  enabled(id: string): boolean;
  console(contribution: ConsoleSpec): void;
}

interface ConsoleSpec {
  slug: string;
  title: string;
  ability: string;
  navigationIcon?: string;
  navigationGroup?: string;
  tabs: Array<{
    key: string;
    label: string;
    description?: string;
    columns: Array<{
      key: string;
      label: string;
      mono?: boolean;
      format?: (value: unknown, row: Row) => string;
      badge?: (value: unknown, row: Row) => Tone | null;
    }>;
    rows: () => Promise<Row[]>;
    rowKey?: string;
    rowActions?: Array<{
      key: string;
      label: string;
      icon?: string;
      danger?: boolean;
      confirm?: string;
      input?: {
        label: string;
        type?: "text" | "number" | "select" | "textarea";
        options?: (row: Row) => string[];
        value?: (row: Row) => string;
        help?: (row: Row) => string | undefined;
      };
      run: (row: Row, input?: string) => Promise<string | void>;
    }>;
    empty?: string;
    badge?: () => Promise<number | null>;
  }>;
}

/** The ability a user needs to see and change settings in the panel. */
export const SETTINGS_ABILITY = "settings.manage";

const SOURCE_TONE: Record<string, Tone> = {
  default: "muted",
  global: "default",
  tenant: "primary",
  user: "success",
  override: "destructive",
};

/** A value as one line of text: JSON for objects, plain for the rest. */
function display(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/** The text a form field starts with, which `setFromText` reads back. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function groupOf(key: string, definition: SettingDefinition): string {
  return definition.group ?? key.split(".")[0] ?? key;
}

/** The level the panel reads and writes: the tenant's, inside one, else app-wide. */
function levelLabel(): string {
  const tenant = TenantContext.tryGet();
  return tenant ? `tenant ${tenant.name ?? tenant.slug ?? tenant.id}` : "the whole app";
}

/**
 * The settings screen's description, as data the panel renders.
 *
 * @internal
 */
export function _settingsConsole(settings: () => SettingsManager): ConsoleSpec {
  const definitions = (): Map<string, SettingDefinition> => new Map(settings().definitions());

  return {
    slug: "settings",
    title: "Settings",
    ability: SETTINGS_ABILITY,
    navigationIcon: "cog",
    navigationGroup: "Settings",
    tabs: [
      {
        key: "settings",
        label: "Settings",
        description:
          "Each setting's value here, and where it comes from. Hiding an override keeps it, " +
          "so it can be unhidden; nothing is ever deleted.",
        empty: "No settings are declared. Declare them with defineSettings().",
        rowKey: "key",
        columns: [
          { key: "group", label: "Group", badge: () => "muted" },
          { key: "label", label: "Setting" },
          { key: "key", label: "Key", mono: true },
          { key: "value", label: "Value", mono: true, format: (v) => display(v) },
          {
            key: "source",
            label: "From",
            badge: (v) => SOURCE_TONE[String(v)] ?? "default",
          },
        ],
        rows: async () => {
          const defs = definitions();
          return (await settings().all()).map((r) => {
            const definition = defs.get(r.key)!;
            return {
              key: r.key,
              group: groupOf(r.key, definition),
              label: definition.label ?? r.key,
              description: definition.description ?? "",
              value: r.value,
              source: r.source,
            };
          });
        },
        rowActions: [
          {
            key: "change",
            label: "Change",
            icon: "pencil",
            input: {
              label: "New value",
              type: "text",
              value: (row) => asText(row["value"]),
              options: (row) => {
                const definition = definitions().get(String(row["key"]));
                if (definition?.type === "boolean") return ["true", "false"];
                return [...(definition?.options ?? [])];
              },
              help: (row) => String(row["description"] ?? "") || undefined,
            },
            run: async (row, input) => {
              const key = String(row["key"]);
              await settings().setFromText(key, input ?? "");
              return `${key} saved for ${levelLabel()}.`;
            },
          },
          {
            key: "hide",
            label: "Hide override",
            icon: "eye-off",
            confirm: "Stop this override applying? It is kept, and can be unhidden.",
            run: async (row) => {
              const key = String(row["key"]);
              if (!(await settings().hide(key))) {
                throw new Error(`${key} has no override for ${levelLabel()} to hide.`);
              }
              return `${key} hidden for ${levelLabel()}; the value is kept.`;
            },
          },
          {
            key: "unhide",
            label: "Unhide",
            icon: "eye",
            run: async (row) => {
              const key = String(row["key"]);
              if (!(await settings().unhide(key))) {
                throw new Error(`${key} has no override for ${levelLabel()} to unhide.`);
              }
              return `${key} applies again for ${levelLabel()}.`;
            },
          },
        ],
      },
      {
        key: "hidden",
        label: "Hidden",
        description: "Overrides that are kept but not applied. Unhide one to apply it again.",
        empty: "Nothing is hidden here.",
        rowKey: "key",
        columns: [
          { key: "key", label: "Key", mono: true },
          { key: "level", label: "Level", badge: (v) => SOURCE_TONE[String(v)] ?? "default" },
          { key: "value", label: "Kept value", mono: true, format: (v) => display(v) },
          { key: "updatedAt", label: "Hidden", format: (v) => (v ? String(v) : "—") },
        ],
        rows: async () => {
          const rows: Row[] = [];
          for (const r of await settings().all()) {
            // The level a write from this screen goes to is the one it can unhide.
            const level = TenantContext.id() !== null ? "tenant" : "global";
            const hidden = r.levels.find((l) => l.kind === level && l.hidden);
            if (hidden) {
              rows.push({ key: r.key, level, value: hidden.value, updatedAt: hidden.updatedAt });
            }
          }
          return rows;
        },
        badge: async () =>
          (await settings().all()).filter((r) => r.levels.some((l) => l.hidden)).length || null,
        rowActions: [
          {
            key: "unhide",
            label: "Unhide",
            icon: "eye",
            run: async (row) => {
              await settings().unhide(String(row["key"]));
              return `${String(row["key"])} applies again for ${levelLabel()}.`;
            },
          },
        ],
      },
    ],
  };
}

/**
 * Contribute the settings screen to the admin panel, when one is installed and
 * has not switched it off with `plugins: { settings: false }`.
 *
 * Called from `SettingsProvider.onBooting()`, where the panel's surface is
 * already bound whatever order the providers were registered in.
 *
 * @internal
 */
export function _installSettingsAdmin(app: Application): void {
  const panel = _optionalService<AdminPanelSink>("admin.panel");
  if (!panel?.enabled("settings")) return;
  panel.console(_settingsConsole(() => app.container.makeSync("settings")));
}
