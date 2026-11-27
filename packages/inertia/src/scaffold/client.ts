/**
 * The browser half of a generated resource: the record's type, the shared form and the three
 * pages, in React or Vue, built from the starters' own components.
 */
import type { _ResourceField, _ResourceModel } from "./fields.ts";
import { _label, _primaryField } from "./fields.ts";
import type { _ResourceNames } from "./names.ts";

/**
 * What the client files are built from.
 *
 * @internal
 */
export interface _ClientContext {
  names: _ResourceNames;
  model: _ResourceModel;
  framework: "react" | "vue";
  /** The form component's name, e.g. `TaskForm`. */
  form: string;
  /** The `lib/` module's name without extension, e.g. `tasks`. */
  lib: string;
}

/**
 * The starter components a generated page is built from, by file under `resources/js/`. The
 * generator checks they are there before writing anything.
 *
 * @internal
 */
export function _requiredComponents(framework: "react" | "vue"): string[] {
  if (framework === "react") {
    return [
      "Layouts/AppLayout.tsx",
      "Components/Button.tsx",
      "Components/Card.tsx",
      "Components/Checkbox.tsx",
      "Components/EmptyState.tsx",
      "Components/Field.tsx",
      "Components/Icon.tsx",
      "Components/Modal.tsx",
      "Components/PageHeader.tsx",
      "Components/Pagination.tsx",
      "types.ts",
    ];
  }
  return [
    "Layouts/AppLayout.vue",
    "Components/Button.vue",
    "Components/Card.vue",
    "Components/CardBody.vue",
    "Components/CardFooter.vue",
    "Components/Checkbox.vue",
    "Components/EmptyState.vue",
    "Components/Icon.vue",
    "Components/Modal.vue",
    "Components/PageHeader.vue",
    "Components/Pagination.vue",
    "Components/SelectField.vue",
    "Components/TextAreaField.vue",
    "Components/TextField.vue",
    "types.ts",
  ];
}

/** `priority` → `PRIORITY_OPTIONS`. */
function optionsName(f: _ResourceField): string {
  return `${f.property.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_OPTIONS`;
}

/** `Task` + `priority` → `TaskPriority`. */
function enumType(c: _ClientContext, f: _ResourceField): string {
  return `${c.model.name}${f.property.charAt(0).toUpperCase()}${f.property.slice(1)}`;
}

/** The field's type as the page receives it. */
function clientType(c: _ClientContext, f: _ResourceField): string {
  const base =
    f.kind === "number"
      ? "number"
      : f.kind === "boolean"
        ? "boolean"
        : f.kind === "enum"
          ? enumType(c, f)
          : "string";
  return f.nullable && f.kind !== "boolean" ? `${base} | null` : base;
}

/** The record's interface name on the client, e.g. `Task`. */
function recordType(c: _ClientContext): string {
  return c.model.name;
}

/**
 * `resources/js/lib/tasks.ts`: the record as the pages receive it, the choices of each enum, and
 * the one-line summary the list shows. Shared by the list and the form, in both kits.
 *
 * @internal
 */
export function _libSource(c: _ClientContext): string {
  const T = recordType(c);
  const enums = c.model.fields.filter((f) => f.kind === "enum");
  const enumBlocks = enums.map(
    (f) => `/** The ${f.label.toLowerCase()} choices, in order, as the form's select lists them. */
export const ${optionsName(f)} = [
${(f.options ?? []).map((o) => `  { value: ${JSON.stringify(o)}, label: ${JSON.stringify(_label(o))} },`).join("\n")}
] as const;

export type ${enumType(c, f)} = (typeof ${optionsName(f)})[number]["value"];`,
  );
  const primary = _primaryField(c.model.fields);
  const summarised = c.model.fields.filter((f) => f !== primary && f.kind !== "text").slice(0, 4);
  const r = c.names.record;
  const part = (f: _ResourceField): string => {
    const v = `${r}.${f.property}`;
    const shown =
      f.kind === "boolean"
        ? `\`${f.label}: \${${v} ? "yes" : "no"}\``
        : f.kind === "enum"
          ? `\`${f.label}: \${${optionsName(f)}.find((o) => o.value === ${v})?.label ?? ${v}}\``
          : `\`${f.label}: \${${v}}\``;
    return f.nullable && f.kind !== "boolean" ? `${v} === null ? null : ${shown}` : shown;
  };
  const summary = summarised.length
    ? `[\n    ${summarised.map(part).join(",\n    ")},\n  ]\n    .filter((part) => part !== null)\n    .join(" · ")`
    : `""`;
  return `${enumBlocks.length ? `${enumBlocks.join("\n\n")}\n\n` : ""}/**
 * A ${c.names.singular} as the server sends it (the routes under app/routes/ build it). Dates
 * arrive as the strings their inputs hold.
 */
export interface ${T} {
  id: number;
${c.model.fields.map((f) => `  ${f.property}: ${clientType(c, f)};`).join("\n")}
}

/** The line under a ${c.names.singular}'s name in the list: its other fields, briefly. */
export function ${r}Summary(${summarised.length ? r : `_${r}`}: ${T}): string {
  return ${summary};
}
`;
}

/** The form's starting value for a field, from the record being edited (if any). */
function initial(c: _ClientContext, f: _ResourceField, record: string): string {
  const v = `${record}?.${f.property}`;
  switch (f.kind) {
    case "boolean":
      return `${v} ?? ${f.defaultValue === true ? "true" : "false"}`;
    case "number":
      // Held as the input's text; the server reads it back as a number.
      return `${v} == null ? "" : String(${record}.${f.property})`;
    case "enum": {
      // A new record starts from the column's default, else from the first choice.
      const start = typeof f.defaultValue === "string" ? f.defaultValue : (f.options?.[0] ?? "");
      return `(${v} ?? ${JSON.stringify(start)}) as ${enumType(c, f)}`;
    }
    default:
      return `${v} ?? ""`;
  }
}

function inputType(f: _ResourceField): string | undefined {
  if (f.kind === "number") return "number";
  if (f.kind === "date") return "date";
  if (f.kind === "datetime") return "datetime-local";
  return undefined;
}

/** The imports the form's fields need from the lib module. */
function libImports(c: _ClientContext): string[] {
  const enums = c.model.fields.filter((f) => f.kind === "enum");
  return [
    ...enums.map(optionsName),
    `type ${recordType(c)}`,
    ...enums.map((f) => `type ${enumType(c, f)}`),
  ];
}

// ── React ────────────────────────────────────────────────────────────────────

function reactControl(c: _ClientContext, f: _ResourceField, first: boolean): string {
  const set = (value: string) => `onChange={(e) => form.setData("${f.property}", ${value})}`;
  const common = `value={form.data.${f.property}}
            error={form.errors.${f.property}}`;
  const required = !f.nullable ? "\n            required" : "";
  const focus = first ? "\n            autoFocus" : "";
  switch (f.kind) {
    case "boolean":
      return `<Checkbox
            label="${f.label}"
            checked={form.data.${f.property}}
            ${set("e.target.checked")}
          />`;
    case "text":
      return `<TextAreaField
            label="${f.label}"${focus}
            rows={4}
            ${common}
            ${set("e.target.value")}${required}
          />`;
    case "enum":
      return `<SelectField
            label="${f.label}"
            options={${optionsName(f)}}
            ${common}
            onChange={(e) => {
              // The option the browser chose, typed as one of the choices.
              const option = ${optionsName(f)}.find((o) => o.value === e.target.value);
              if (option) form.setData("${f.property}", option.value);
            }}
          />`;
    default: {
      const type = inputType(f);
      return `<TextField
            label="${f.label}"${type ? `\n            type="${type}"` : ""}${focus}
            ${common}
            ${set("e.target.value")}${required}
          />`;
    }
  }
}

/**
 * `Components/TaskForm.tsx`: the create and edit form, which differ only in where they send the
 * data and what the button says.
 *
 * @internal
 */
export function _reactForm(c: _ClientContext): string {
  const T = recordType(c);
  const r = c.names.record;
  const kinds = new Set(c.model.fields.map((f) => f.kind));
  const fields = [
    ...(kinds.has("string") || kinds.has("number") || kinds.has("date") || kinds.has("datetime")
      ? ["TextField"]
      : []),
    ...(kinds.has("text") ? ["TextAreaField"] : []),
    ...(kinds.has("enum") ? ["SelectField"] : []),
  ].sort();
  const imports = [
    `import type { FormEvent } from "react";`,
    `import { Link, useForm } from "@inertiajs/react";`,
    `import { Button } from "./Button";`,
    `import { Card, CardBody, CardFooter } from "./Card";`,
    ...(kinds.has("boolean") ? [`import { Checkbox } from "./Checkbox";`] : []),
    ...(fields.length ? [`import { ${fields.join(", ")} } from "./Field";`] : []),
    `import { ${libImports(c).join(", ")} } from "../lib/${c.lib}";`,
  ];
  const firstFocusable = c.model.fields.find((f) => f.kind !== "boolean" && f.kind !== "enum");
  return `${imports.join("\n")}

/**
 * The create and edit form, which differ only in where they send the data and what the
 * button says.
 */
export function ${c.form}({ ${r} }: { ${r}?: ${T} | undefined }) {
  const form = useForm({
${c.model.fields.map((f) => `    ${f.property}: ${initial(c, f, r)},`).join("\n")}
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (${r}) form.put(route("${c.names.segment}.update", { ${r}: ${r}.id }));
    else form.post(route("${c.names.segment}.store"));
  }

  return (
    <Card>
      <form onSubmit={submit}>
        <CardBody className="space-y-5">
${c.model.fields.map((f) => `          ${reactControl(c, f, f === firstFocusable)}`).join("\n")}
        </CardBody>
        <CardFooter>
          <Link
            href={route("${c.names.segment}")}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={form.processing}>
            {form.processing ? "Saving…" : ${r} ? "Save changes" : "Create ${c.names.singular}"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
`;
}

/** The text the list links a record by. */
function shownAs(c: _ClientContext, record: string): { expr: string } {
  const primary = _primaryField(c.model.fields);
  if (!primary) return { expr: `\`#\${${record}.id}\`` };
  return primary.nullable
    ? { expr: `${record}.${primary.property} || \`#\${${record}.id}\`` }
    : { expr: `${record}.${primary.property}` };
}

/**
 * The three React pages, keyed by page name under the pages directory.
 *
 * @internal
 */
export function _reactPages(
  c: _ClientContext,
  components: { index: string; create: string; edit: string },
): Record<"index" | "create" | "edit", string> {
  const { names } = c;
  const T = recordType(c);
  const r = names.record;
  const shown = shownAs(c, r);
  const shownDeleting = shownAs(c, "deleting").expr;
  const index = `import { useState, type ReactNode } from "react";
import { Head, Link, router } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { Button, ButtonLink } from "../../Components/Button";
import { Card } from "../../Components/Card";
import { EmptyState } from "../../Components/EmptyState";
import { FolderIcon, PencilIcon, PlusIcon, TrashIcon } from "../../Components/Icon";
import { Modal } from "../../Components/Modal";
import { PageHeader } from "../../Components/PageHeader";
import { Pagination } from "../../Components/Pagination";
import { ${r}Summary, type ${T} } from "../../lib/${c.lib}";
import type { Pagination as PaginationData } from "../../types";

interface Props {
  title: string;
  ${names.records}: ${T}[];
  pagination: PaginationData;
}

/** ${"/" + names.segment}?page=…, leaving out the first page's number. */
function listUrl(page: number): string {
  return route("${names.segment}") + (page > 1 ? \`?page=\${page}\` : "");
}

function ${components.index}({ title, ${names.records}, pagination }: Props) {
  const [deleting, setDeleting] = useState<${T} | null>(null);

  return (
    <>
      <Head title={title} />

      <PageHeader
        title="${names.title}"
        actions={
          <ButtonLink href={route("${names.segment}.create")}>
            <PlusIcon className="size-4" />
            New ${names.singular}
          </ButtonLink>
        }
      />

      {pagination.total === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title="No ${names.plural} yet"
          description="Create the first one, and it is listed here."
          action={
            <ButtonLink href={route("${names.segment}.create")}>
              <PlusIcon className="size-4" />
              Create a ${names.singular}
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {${names.records}.map((${r}) => (
                <li key={${r}.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={route("${names.segment}.edit", { ${r}: ${r}.id })}
                      className="block truncate font-medium hover:underline"
                    >
                      {${shown.expr}}
                    </Link>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {${r}Summary(${r})}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <ButtonLink
                      href={route("${names.segment}.edit", { ${r}: ${r}.id })}
                      variant="ghost"
                      size="icon"
                      aria-label="Edit"
                    >
                      <PencilIcon className="size-4" />
                    </ButtonLink>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete"
                      onClick={() => setDeleting(${r})}
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Pagination pagination={pagination} href={listUrl} noun="${names.plural}" />
        </div>
      )}

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting ? \`Delete “\${${shownDeleting}}”?\` : ""}
        description="The ${names.singular} is removed for good. This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                deleting &&
                router.delete(route("${names.segment}.destroy", { ${r}: deleting.id }), {
                  preserveScroll: true,
                  onFinish: () => setDeleting(null),
                })
              }
            >
              Delete ${names.singular}
            </Button>
          </>
        }
      />
    </>
  );
}

// The layout persists across visits: only the page re-renders.
${components.index}.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default ${components.index};
`;

  const formPage = (component: string, edit: boolean) => `import type { ReactNode } from "react";
import { Head } from "@inertiajs/react";
import AppLayout from "../../Layouts/AppLayout";
import { PageHeader } from "../../Components/PageHeader";
import { ${c.form} } from "../../Components/${c.form}";${edit ? `\nimport type { ${T} } from "../../lib/${c.lib}";` : ""}

interface Props {
  title: string;${edit ? `\n  ${r}: ${T};` : ""}
}

function ${component}({ title${edit ? `, ${r}` : ""} }: Props) {
  return (
    <>
      <Head title={title} />
      <div className="max-w-2xl">
        <PageHeader
          title={${edit ? `${shownAs(c, r).expr}` : `"New ${names.singular}"`}}
          back={{ href: route("${names.segment}"), label: "${names.title}" }}
        />
        <${c.form}${edit ? ` ${r}={${r}}` : ""} />
      </div>
    </>
  );
}

// The layout persists across visits: only the page re-renders.
${component}.layout = (page: ReactNode) => <AppLayout>{page}</AppLayout>;

export default ${component};
`;

  return {
    index,
    create: formPage(components.create, false),
    edit: formPage(components.edit, true),
  };
}

// ── Vue ──────────────────────────────────────────────────────────────────────

function vueControl(f: _ResourceField, first: boolean): string {
  const attrs = (...parts: string[]) => parts.filter(Boolean).join(" ");
  const required = f.nullable ? "" : "required";
  const focus = first ? "autofocus" : "";
  const error = `:error="form.errors.${f.property}"`;
  switch (f.kind) {
    case "boolean":
      return `<Checkbox v-model="form.${f.property}" label="${f.label}" />`;
    case "text":
      return `<TextAreaField ${attrs(`v-model="form.${f.property}"`, `label="${f.label}"`, focus, `rows="4"`, error, required)} />`;
    case "enum":
      return `<SelectField ${attrs(`v-model="form.${f.property}"`, `label="${f.label}"`, `:options="${optionsName(f)}"`, error)} />`;
    default: {
      const type = inputType(f);
      return `<TextField ${attrs(`v-model="form.${f.property}"`, `label="${f.label}"`, type ? `type="${type}"` : "", focus, error, required)} />`;
    }
  }
}

/**
 * `Components/TaskForm.vue`.
 *
 * @internal
 */
export function _vueForm(c: _ClientContext): string {
  const T = recordType(c);
  const r = c.names.record;
  const kinds = new Set(c.model.fields.map((f) => f.kind));
  const components = [
    "Button",
    "Card",
    "CardBody",
    "CardFooter",
    ...(kinds.has("boolean") ? ["Checkbox"] : []),
    ...(kinds.has("enum") ? ["SelectField"] : []),
    ...(kinds.has("text") ? ["TextAreaField"] : []),
    ...(kinds.has("string") || kinds.has("number") || kinds.has("date") || kinds.has("datetime")
      ? ["TextField"]
      : []),
  ];
  const firstFocusable = c.model.fields.find((f) => f.kind !== "boolean" && f.kind !== "enum");
  return `<script setup lang="ts">
/**
 * The create and edit form, which differ only in where they send the data and what the
 * button says.
 */
import { Link, useForm } from "@inertiajs/vue3";
${components.map((name) => `import ${name} from "./${name}.vue";`).join("\n")}
import { ${libImports(c).join(", ")} } from "../lib/${c.lib}";

const props = defineProps<{ ${r}?: ${T} | undefined }>();

const form = useForm({
${c.model.fields.map((f) => `  ${f.property}: ${initial(c, f, `props.${r}`)},`).join("\n")}
});

function submit() {
  if (props.${r}) form.put(route("${c.names.segment}.update", { ${r}: props.${r}.id }));
  else form.post(route("${c.names.segment}.store"));
}
</script>

<template>
  <Card>
    <form @submit.prevent="submit">
      <CardBody class="space-y-5">
${c.model.fields.map((f) => `        ${vueControl(f, f === firstFocusable)}`).join("\n")}
      </CardBody>
      <CardFooter>
        <Link
          :href="route('${c.names.segment}')"
          class="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </Link>
        <Button type="submit" :disabled="form.processing">
          {{ form.processing ? "Saving…" : ${r} ? "Save changes" : "Create ${c.names.singular}" }}
        </Button>
      </CardFooter>
    </form>
  </Card>
</template>
`;
}

/** A JavaScript expression as a Vue template reads it: double quotes would end the attribute. */
function inTemplate(expr: string): string {
  return expr.replace(/"/g, "'");
}

/**
 * The three Vue pages.
 *
 * @internal
 */
export function _vuePages(
  c: _ClientContext,
  components: { index: string; create: string; edit: string },
): Record<"index" | "create" | "edit", string> {
  const { names } = c;
  const T = recordType(c);
  const r = names.record;
  const shown = shownAs(c, r).expr;
  const shownDeleting = shownAs(c, "deleting.value").expr;
  const index = `<script setup lang="ts">
import { ref } from "vue";
import { Head, Link, router } from "@inertiajs/vue3";
import AppLayout from "../../Layouts/AppLayout.vue";
import Button from "../../Components/Button.vue";
import Card from "../../Components/Card.vue";
import EmptyState from "../../Components/EmptyState.vue";
import Icon from "../../Components/Icon.vue";
import Modal from "../../Components/Modal.vue";
import PageHeader from "../../Components/PageHeader.vue";
import Pagination from "../../Components/Pagination.vue";
import { ${r}Summary, type ${T} } from "../../lib/${c.lib}";
import type { Pagination as PaginationData } from "../../types";

// The layout persists across visits: only the page re-renders.
defineOptions({ name: "${components.index}", layout: AppLayout });

defineProps<{
  title: string;
  ${names.records}: ${T}[];
  pagination: PaginationData;
}>();

/** ${"/" + names.segment}?page=…, leaving out the first page's number. */
function listUrl(page: number): string {
  return route("${names.segment}") + (page > 1 ? \`?page=\${page}\` : "");
}

const deleting = ref<${T} | null>(null);

function destroy() {
  if (!deleting.value) return;
  router.delete(route("${names.segment}.destroy", { ${r}: deleting.value.id }), {
    preserveScroll: true,
    onFinish: () => (deleting.value = null),
  });
}

/** What the delete dialog names the ${names.singular} by. */
function deletingName(): string {
  return deleting.value ? ${shownDeleting} : "";
}
</script>

<template>
  <Head :title="title" />

  <PageHeader title="${names.title}">
    <template #actions>
      <Button :href="route('${names.segment}.create')">
        <Icon name="plus" class="size-4" />
        New ${names.singular}
      </Button>
    </template>
  </PageHeader>

  <EmptyState
    v-if="pagination.total === 0"
    icon="folder"
    title="No ${names.plural} yet"
    description="Create the first one, and it is listed here."
  >
    <template #action>
      <Button :href="route('${names.segment}.create')">
        <Icon name="plus" class="size-4" />
        Create a ${names.singular}
      </Button>
    </template>
  </EmptyState>

  <div v-else class="space-y-4">
    <Card class="overflow-hidden">
      <ul class="divide-y divide-border">
        <li v-for="${r} in ${names.records}" :key="${r}.id" class="flex items-center gap-4 px-4 py-4 sm:px-5">
          <div class="min-w-0 flex-1">
            <Link
              :href="route('${names.segment}.edit', { ${r}: ${r}.id })"
              class="block truncate font-medium hover:underline"
            >
              {{ ${inTemplate(shown)} }}
            </Link>
            <p class="mt-0.5 truncate text-sm text-muted-foreground">{{ ${r}Summary(${r}) }}</p>
          </div>
          <div class="flex shrink-0 gap-1">
            <Button
              :href="route('${names.segment}.edit', { ${r}: ${r}.id })"
              variant="ghost"
              size="icon"
              aria-label="Edit"
            >
              <Icon name="pencil" class="size-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Delete" @click="deleting = ${r}">
              <Icon name="trash" class="size-4" />
            </Button>
          </div>
        </li>
      </ul>
    </Card>

    <Pagination :pagination="pagination" :href="listUrl" noun="${names.plural}" />
  </div>

  <Modal
    :open="deleting !== null"
    :title="\`Delete “\${deletingName()}”?\`"
    description="The ${names.singular} is removed for good. This cannot be undone."
    @close="deleting = null"
  >
    <template #footer>
      <Button variant="secondary" @click="deleting = null">Cancel</Button>
      <Button variant="danger" @click="destroy">Delete ${names.singular}</Button>
    </template>
  </Modal>
</template>
`;

  const formPage = (component: string, edit: boolean) => `<script setup lang="ts">
import { Head } from "@inertiajs/vue3";
import AppLayout from "../../Layouts/AppLayout.vue";
import PageHeader from "../../Components/PageHeader.vue";
import ${c.form} from "../../Components/${c.form}.vue";${edit ? `\nimport type { ${T} } from "../../lib/${c.lib}";` : ""}

// The layout persists across visits: only the page re-renders.
defineOptions({ name: "${component}", layout: AppLayout });

defineProps<{ title: string${edit ? `; ${r}: ${T}` : ""} }>();
</script>

<template>
  <Head :title="title" />
  <div class="max-w-2xl">
    <PageHeader
      ${edit ? `:title="${inTemplate(shown)}"` : `title="New ${names.singular}"`}
      :back="{ href: route('${names.segment}'), label: '${names.title}' }"
    />
    <${c.form}${edit ? ` :${kebab(r)}="${r}"` : ""} />
  </div>
</template>
`;

  return {
    index,
    create: formPage(components.create, false),
    edit: formPage(components.edit, true),
  };
}

/** `blogPost` → `blog-post`, as a Vue template names a prop. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
