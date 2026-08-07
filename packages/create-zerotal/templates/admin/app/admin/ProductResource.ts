import {
  Resource,
  text,
  toggleColumn,
  selectColumn,
  textInput,
  textarea,
  toggle,
  select,
  formSection,
  section,
  textEntry,
  iconEntry,
  tab,
  queryBuilder,
  textConstraint,
  numberConstraint,
  selectConstraint,
  booleanConstraint,
  action,
  actionGroup,
  viewAction,
  editAction,
  deleteAction,
  replicateAction,
  createAction,
  exportAction,
  importAction,
  bulkExportAction,
  bulkDeleteAction,
} from "@zerotal/admin";
import type { AdminRecord } from "@zerotal/admin";
import { Product } from "@app/models/Product";
import { money } from "@app/admin/shared";

const STATUS = { draft: "Draft", active: "Active", discontinued: "Discontinued" };

/**
 * The catalogue — the resource to copy when you add your own.
 *
 * It shows the parts of a table that most resources end up wanting: filter tabs
 * with live counts, a build-your-own filter, footer summaries, an overflow menu
 * for the occasional actions, CSV import/export, and soft deletes.
 */
export class ProductResource extends Resource {
  static override model = Product;
  static override navigationIcon = "collection";
  static override navigationSort = 1;
  static override recordTitleAttribute = "name";
  static override defaultSort = { column: "created_at", direction: "desc" as const };

  /** A count beside the sidebar entry. Cached, and refreshed on every write. */
  static override navigationBadge() {
    return this.count((q) => q.where("status", "active"));
  }

  static override tabs() {
    return [
      tab("all").label("All").badge(),
      tab("active")
        .label("Active")
        .badge()
        .badgeColor("success")
        .modifyQuery((q) => q.where("status", "active")),
      tab("draft")
        .label("Drafts")
        .badge()
        .badgeColor("muted")
        .modifyQuery((q) => q.where("status", "draft")),
    ];
  }

  static override filters() {
    return [
      queryBuilder("q")
        .label("Advanced filter")
        .constraints([
          textConstraint("name"),
          textConstraint("sku").label("SKU"),
          numberConstraint("price").label("Price (cents)"),
          numberConstraint("stock"),
          selectConstraint("status").options(STATUS),
          booleanConstraint("featured"),
        ]),
    ];
  }

  static override headerActions() {
    return [createAction(), exportAction(), importAction()];
  }

  static override bulkActions() {
    return [bulkExportAction(), bulkDeleteAction()];
  }

  static override recordActions() {
    return [
      viewAction(),
      editAction(),
      // Occasional and destructive actions go behind one menu, so the row keeps
      // two buttons rather than five.
      actionGroup([
        replicateAction()
          .excludeAttributes(["sku"])
          .beforeReplicaSaved((data) => ({
            ...data,
            name: `${String(data["name"])} (copy)`,
            status: "draft",
          })),
        action("feature")
          .label("Feature")
          .icon("plus")
          .visible((rec) => !(rec as unknown as Product)?.featured)
          .run(async ({ record, resource }) => {
            await resource.update(record!.id, { featured: true });
          })
          .successMessage("Product featured."),
        deleteAction(),
      ]).label("More"),
    ];
  }

  static override columns() {
    return [
      text("name").searchable().sortable(),
      text("sku").label("SKU").searchable().copyable(),
      text("price")
        .sortable()
        .align("end")
        .format((v) => money(v))
        .sum("Total value", (n) => money(n)),
      text("stock").sortable().align("end").sum("Units"),
      selectColumn("status", STATUS).label("Status"),
      toggleColumn("featured").label("Featured"),
    ];
  }

  static override form() {
    return [
      formSection("Product")
        .columns(2)
        .schema([
          textInput("name").required().minLength(2).maxLength(120).columnSpan(2),
          textInput("sku").label("SKU").required().maxLength(40),
          select("status").options(STATUS).default("draft").required(),
          textInput("price")
            .label("Price (cents)")
            .numeric()
            .required()
            .min(0)
            .helperText("Stored in minor units so money never rides on a float."),
          textInput("stock").numeric().min(0).default(0),
          textarea("description").rows(4).columnSpan(2),
          toggle("featured").label("Featured").columnSpan(2),
        ]),
    ];
  }

  static override infolist() {
    return [
      section("Product")
        .icon("collection")
        .columns(2)
        .schema([
          textEntry("name").weight("semibold").size("lg"),
          textEntry("sku").label("SKU").copyable(),
          textEntry("price").format((v) => money(v)),
          textEntry("stock"),
          textEntry("status")
            .badge()
            .color((v) => (v === "active" ? "success" : "muted")),
          iconEntry("featured").label("Featured"),
          textEntry("description").columnSpan(2).placeholder("(no description)"),
        ]),
    ];
  }

  /** Runs on every save, after validation and before the write. */
  static override mutateBeforeSave(data: AdminRecord): AdminRecord {
    if (typeof data["sku"] === "string") data["sku"] = data["sku"].toUpperCase();
    return data;
  }

  static override emptyState() {
    return {
      heading: "No products yet",
      description: "Add your first product, or import a catalogue from a CSV file.",
      icon: "collection",
      actions: [createAction(), importAction()],
    };
  }
}
