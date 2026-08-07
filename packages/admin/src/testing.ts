/**
 * Admin testing helpers — thin, resource-aware wrappers over Flow's in-process
 * test harness ({@link FlowTest}). They mount a resource's List / View / Form
 * page without the route boilerplate, and add assertions phrased in admin terms
 * (columns, records, actions, fields).
 *
 * @example
 * import { AdminTest, assertHasColumn, assertHasAction } from "@zerotal/admin/testing";
 *
 * const t = await AdminTest.list(UserResource);
 * assertHasColumn(t, UserResource, "email");
 * assertHasAction(t, "Create");
 * t.assertSee("ada@example.com");
 *
 * const form = await AdminTest.form(UserResource, "create");
 * await form.set("form", { name: "" });
 * await form.call("save");
 * form.assertHasErrors("name");
 */
import { FlowTest } from "@zerotal/flow/testing";
import type { Component } from "@zerotal/flow";
import type { ResourceClass } from "./Panel.ts";
import { Panel } from "./Panel.ts";
import type { PanelInstance } from "./PanelInstance.ts";
import type { FieldMode } from "./form/index.ts";
import { makeResourceForm, flattenFields } from "./form/index.ts";
import { makeResourceListPage } from "./pages/ResourceListPage.tsx";
import { makeRecordViewPage } from "./pages/RecordViewPage.tsx";
import { ResourceFormPage, registerResourceForm } from "./pages/ResourceFormPage.tsx";

/** A mounted Flow test for any admin page. */
export type AdminPageTest = FlowTest<Component>;

export const AdminTest = {
  /** Mount a resource's List page. `props` seed `@url` state (search/sort/page/…). */
  async list(
    resource: ResourceClass,
    props: Record<string, unknown> = {},
    panel: PanelInstance = Panel.default(),
  ): Promise<AdminPageTest> {
    return FlowTest.mount(
      makeResourceListPage(resource, panel) as unknown as new () => Component,
      props as Partial<Component>,
    );
  },

  /** Mount a resource's View page for a record id. */
  async view(
    resource: ResourceClass,
    recordId: string | number,
    panel: PanelInstance = Panel.default(),
  ): Promise<AdminPageTest> {
    return FlowTest.mount(
      makeRecordViewPage(resource, panel) as unknown as new () => Component,
      {
        recordId: String(recordId),
      } as Partial<Component>,
    );
  },

  /**
   * Mount a resource's Create/Edit form page. Registers the resource's form
   * config (as the provider does) so the shared page can resolve it by slug.
   */
  async form(
    resource: ResourceClass,
    mode: FieldMode = "create",
    props: Record<string, unknown> = {},
    panel: PanelInstance = Panel.default(),
  ): Promise<AdminPageTest> {
    const slug = resource.getSlug();
    const model = resource.getModelName();
    const fields = resource.form();
    const create = makeResourceForm(fields, "create", `${model}CreateTestForm`);
    const edit = makeResourceForm(fields, "edit", `${model}EditTestForm`);
    registerResourceForm(panel.id, slug, {
      resource,
      create: { FormClass: create.FormClass, fields: create.fields },
      edit: { FormClass: edit.FormClass, fields: edit.fields },
    });
    return FlowTest.mount(
      ResourceFormPage as unknown as new () => Component,
      {
        slug,
        mode,
        panelId: panel.id,
        ...props,
      } as Partial<Component>,
    );
  },
};

// ── Resource-aware assertions ───────────────────────────────────────────────

/** Assert a column's header is rendered (by key → its resolved label). */
export function assertHasColumn(t: AdminPageTest, resource: ResourceClass, key: string): void {
  const col = resource.columns().find((c) => c._key === key);
  t.assertSee(col ? col.getLabel() : key);
}

/** Assert an action label is present on the page. */
export function assertHasAction(t: AdminPageTest, label: string): void {
  t.assertSee(label);
}

/** Assert a form field's label is rendered (by key → its resolved label). */
export function assertHasField(t: AdminPageTest, resource: ResourceClass, key: string): void {
  const field = flattenFields(resource.form()).find((f) => f._key === key);
  t.assertSee(field ? field.getLabel() : key);
}

/** Assert the rendered HTML contains a record's title (a row is present). */
export function assertSeesRecord(
  t: AdminPageTest,
  resource: ResourceClass,
  record: Record<string, unknown>,
): void {
  t.assertSee(resource.recordTitle(record));
}

export { FlowTest };
