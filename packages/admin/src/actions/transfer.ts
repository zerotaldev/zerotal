/**
 * Import and export actions — moving records in and out of the panel as CSV.
 *
 *   static headerActions() {
 *     return [createAction(), exportAction(), importAction()];
 *   }
 *
 *   static bulkActions() {
 *     return [bulkExportAction(), bulkDeleteAction()];
 *   }
 *
 * An export reflects the list exactly as the user left it: the same search, the
 * same filters, the same tab, the same sort. That is the whole point — someone
 * who has narrowed a table to the twelve rows they care about expects twelve
 * rows in the file, not the entire table.
 */
import { Action } from "./Action.ts";
import type { ActionContext } from "./Action.ts";
import { toCsv, parseCsv, guessColumnMapping } from "./csv.ts";
import { toXlsx } from "./xlsx.ts";
import { flattenFields, fileUpload, select } from "../form/index.ts";
import type { Column } from "../table/Column.ts";
import type { ResourceClass } from "../Panel.ts";
import { DEFAULT_PANEL_ID } from "../Panel.ts";

/**
 * How many rows one import may create.
 *
 * A synchronous import holds a WebSocket round-trip open, so a hundred-thousand
 * row file would look like a hang and time out half-written. Files beyond this
 * belong on a queue; the action says so rather than trying and failing.
 */
export const IMPORT_ROW_LIMIT = 2000;

/** Columns that may leave the panel, in table order. */
function exportableColumns(resource: ResourceClass): Column[] {
  return resource.columns().filter((c) => c._exportable);
}

/** What an export is written as. */
export type ExportFormat = "csv" | "xlsx";

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** `orders-2026-07-28.csv` — dated, so repeated exports don't overwrite each other. */
function exportFilename(resource: ResourceClass, format: ExportFormat): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${resource.getSlug()}-${date}.${format}`;
}

function deliver(ctx: ActionContext, rows: Record<string, unknown>[], format: ExportFormat): void {
  // `download` is present on every panel page; a custom host that lacks it gets
  // told rather than silently doing nothing.
  if (typeof ctx.page.download !== "function") {
    ctx.page.flash("This page cannot deliver downloads.", "warning");
    return;
  }
  const columns = exportableColumns(ctx.resource);
  const body =
    format === "xlsx"
      ? toXlsx(rows, columns, { sheet: ctx.resource.getPluralLabel() })
      : toCsv(rows, columns);
  ctx.page.download(exportFilename(ctx.resource, format), body, MIME[format]);
}

/**
 * Header action → download every row the current list query returns.
 *
 * Reads `ctx.listOptions`, which the list page fills with its live scope, and
 * asks for all of it rather than the visible page.
 */
export function exportAction(format: ExportFormat = "csv"): Action {
  return new Action(format === "xlsx" ? "export-xlsx" : "export")
    .label(format === "xlsx" ? "Export to Excel" : "Export")
    .icon("download")
    .run(async (ctx) => {
      const { resource, listOptions } = ctx;
      const rows = await resource.listAll(listOptions ?? {});
      if (rows.length === 0) {
        ctx.page.flash("Nothing to export.", "warning");
        return;
      }
      deliver(ctx, rows, format);
    })
    .authorize((_rec, ctx) => ctx.resource.can("viewAny"));
}

/** Bulk action → download just the selected rows. */
export function bulkExportAction(format: ExportFormat = "csv"): Action {
  return new Action(format === "xlsx" ? "bulk-export-xlsx" : "bulk-export")
    .label(format === "xlsx" ? "Export to Excel" : "Export")
    .icon("download")
    .asBulk()
    .run(async (ctx) => {
      // Bulk dispatch hands over ids; the rows are loaded here rather than for
      // every bulk action, most of which never need them.
      const rows = ctx.records?.length
        ? (ctx.records as Record<string, unknown>[])
        : ((await Promise.all((ctx.ids ?? []).map((id) => ctx.resource.find(id)))).filter(
            Boolean,
          ) as Record<string, unknown>[]);

      if (rows.length === 0) {
        ctx.page.flash("Nothing to export.", "warning");
        return;
      }
      deliver(ctx, rows, format);
    })
    .authorize((_rec, ctx) => ctx.resource.can("viewAny"));
}

/** The outcome of an import, as reported back to the user. */
export interface ImportResult {
  created: number;
  /** One message per rejected row, already prefixed with its line number. */
  failures: string[];
}

/**
 * Turn CSV text into records on `resource`.
 *
 * Every row is validated through the resource's own form fields, so an import
 * cannot write anything a human couldn't have typed into the create form. A row
 * that fails is reported and skipped — one bad line out of five hundred should
 * not discard the other four hundred and ninety-nine.
 */
export async function importCsv(
  resource: ResourceClass,
  csv: string,
  /** Column index → field key. Omit to infer from the header row. */
  mapping?: Record<number, string>,
  /** `limit` overrides the row cap — a queued import has no request to hold open. */
  options: { limit?: number } = {},
): Promise<ImportResult> {
  const rows = parseCsv(csv);
  const result: ImportResult = { created: 0, failures: [] };
  if (rows.length < 2) {
    result.failures.push("The file has no data rows.");
    return result;
  }

  const fields = flattenFields(resource.form());
  const resolved =
    mapping ??
    guessColumnMapping(
      rows[0]!,
      fields.map((f) => ({ key: f._key, label: f.getLabel() })),
    );
  if (Object.keys(resolved).length === 0) {
    result.failures.push("No column in the file matches a field on this resource.");
    return result;
  }

  const byKey = new Map(fields.map((f) => [f._key, f]));
  const dataRows = rows.slice(1);
  const limit = options.limit ?? IMPORT_ROW_LIMIT;
  if (dataRows.length > limit) {
    result.failures.push(
      `The file has ${dataRows.length} rows; ${limit} is the most one import can take. ` +
        "Queue the import to lift that.",
    );
    return result;
  }

  for (const [i, row] of dataRows.entries()) {
    // Line numbers are what the user sees in their spreadsheet: 1 is the header.
    const line = i + 2;
    // A row that is entirely blank is trailing whitespace, not a failure.
    if (row.every((cell) => cell.trim() === "")) continue;

    const data: Record<string, unknown> = {};
    for (const [index, key] of Object.entries(resolved)) {
      const cell = row[Number(index)];
      if (cell === undefined) continue;
      data[key] = cell;
    }

    const missing = fields
      .filter((f) => f._required && !String(data[f._key] ?? "").trim())
      .map((f) => f.getLabel());
    if (missing.length > 0) {
      result.failures.push(`Row ${line}: missing ${missing.join(", ")}.`);
      continue;
    }

    try {
      for (const [key, value] of Object.entries(data)) {
        const field = byKey.get(key);
        if (field) data[key] = await field.dehydrate(value);
      }
      const record = await resource.create(resource.mutateBeforeSave(data, "create"));
      await resource.afterSave((record ?? data) as Record<string, unknown>, "create");
      result.created++;
    } catch (err) {
      result.failures.push(`Row ${line}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

/** Field key a mapping select writes to, for CSV column `index`. */
export const MAPPING_FIELD_PREFIX = "map_";

/**
 * Header action → upload a CSV and create a record per row.
 *
 * The modal has two steps in one screen: pick a file, and then — once its header
 * row is readable — one select per column saying which field it feeds. The
 * selects start on whatever the header names match, so a file the panel exported
 * needs no adjustment, and a file from somewhere else needs only the columns that
 * didn't line up.
 */
export function importAction(options: { queue?: boolean } = {}): Action {
  return new Action("import")
    .label("Import")
    .icon("upload")
    .modalHeading("Import records")
    .modalSubmitLabel("Import")
    .formUsing((data, resource) => {
      const file = fileUpload("file")
        .label("CSV file")
        .accept(".csv,text/csv")
        .required()
        .helperText("The first row must be a header.");

      const csv = String(data["file"] ?? "");
      if (!csv.trim()) return [file];

      const rows = parseCsv(csv);
      const headers = rows[0] ?? [];
      if (headers.length === 0) return [file];

      // Fields the resource can actually accept, plus the option to skip.
      const target = flattenFields(resource.form());
      const options: Record<string, string> = { "": "— skip this column —" };
      for (const f of target) options[f._key] = f.getLabel();

      return [
        file,
        ...headers.map((header, i) =>
          select(`${MAPPING_FIELD_PREFIX}${i}`)
            .label(header || `Column ${i + 1}`)
            .options(options)
            .helperText(`${rows.length - 1} row${rows.length === 2 ? "" : "s"} of data`),
        ),
      ];
    })
    .authorize((_rec, ctx) => ctx.resource.can("create"))
    .run(async (ctx) => {
      const csv = String(ctx.data?.["file"] ?? "");
      if (!csv.trim()) {
        ctx.page.flash("Choose a CSV file to import.", "warning");
        return;
      }

      // Whatever the mapping selects hold wins; an untouched modal falls back to
      // inference, which is the same thing the selects were seeded with.
      const chosen: Record<number, string> = {};
      for (const [key, value] of Object.entries(ctx.data ?? {})) {
        if (!key.startsWith(MAPPING_FIELD_PREFIX)) continue;
        const field = String(value ?? "");
        if (field) chosen[Number(key.slice(MAPPING_FIELD_PREFIX.length))] = field;
      }
      const mapping = Object.keys(chosen).length > 0 ? chosen : undefined;

      // Hand a big file to the queue when the app asked for it. A worker has no
      // request to hold open, so the row cap doesn't apply there.
      if (options.queue) {
        const { dispatchImport } = await import("./ImportRecordsJob.ts");
        const queued = await dispatchImport({
          panelId: ctx.panelId ?? DEFAULT_PANEL_ID,
          slug: ctx.slug,
          csv,
          mapping,
        });
        if (queued) {
          ctx.page.flash("Import queued. Rows will appear as the worker gets through them.");
          return;
        }
        // No queue configured — importing inline beats silently doing nothing.
      }

      const { created, failures } = await importCsv(ctx.resource, csv, mapping);

      if (created === 0) {
        ctx.page.flash(failures[0] ?? "Nothing was imported.", "warning");
        return;
      }
      const label = created === 1 ? ctx.resource.getLabel() : ctx.resource.getPluralLabel();
      if (failures.length === 0) {
        ctx.page.flash(`Imported ${created} ${label.toLowerCase()}.`);
        return;
      }
      // Lead with what worked, then the first few problems — a hundred identical
      // failures in a flash message helps nobody.
      const shown = failures.slice(0, 3).join(" ");
      const rest = failures.length > 3 ? ` (+${failures.length - 3} more)` : "";
      ctx.page.flash(
        `Imported ${created} ${label.toLowerCase()}; ${failures.length} skipped. ${shown}${rest}`,
        "warning",
      );
    });
}
