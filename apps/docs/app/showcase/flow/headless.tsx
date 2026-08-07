import {
  Component,
  expose,
  Switch,
  Checkbox,
  Select,
  RadioGroup,
  Listbox,
  Combobox,
  Disclosure,
  Accordion,
  Popover,
  Tooltip,
  Field,
} from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

/**
 * The headless, fully-accessible primitives from @zerotal/flow. They ship unstyled and
 * expose their state through `data-*` attributes (`data-checked`, `data-selected`,
 * `data-active`, `data-open`), so you paint them entirely with Tailwind variants —
 * `data-[checked]:` / `group-data-[checked]:` etc. Keyboard navigation, ARIA roles, and
 * two-way binding are built in; the look is 100% yours. Each demo shows the live component
 * with its usage code below.
 */
export class HeadlessPage extends Component {
  static title = "Headless primitives — Flow showcase";

  @expose airplane = false;
  @expose newsletter = true;
  @expose fruit = "apple";
  @expose plan = "pro";
  @expose assignee = "ada";
  @expose city = "";

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  private section(label: string, hint: string, code: string, body: HtmlNode): HtmlNode {
    return (
      <div>
        <div class="mb-3">
          <p class="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
          <p class="mt-0.5 text-xs text-slate-400">{hint}</p>
        </div>
        <Demo code={code}>{body}</Demo>
      </div>
    );
  }

  override async render(): Promise<HtmlNode> {
    const opt =
      "cursor-pointer rounded-lg px-3 py-2 text-sm data-[active]:bg-slate-100 data-[selected]:font-semibold data-[selected]:text-orange-600";

    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Headless primitives</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            Unstyled, accessible building blocks. They emit state as{" "}
            <code class="font-mono text-orange-600">data-*</code> attributes and you style them with
            Tailwind variants — nothing here ships a look you have to override. Two-way binding,
            roving keyboard nav, and ARIA are handled for you. Each demo shows the live component
            with its usage code below.
          </p>
        </div>

        <div class="space-y-6">
          {this.section(
            "Switch",
            "role=switch · data-[checked]: on a group",
            `<Switch bind={this.airplane} class="... data-[checked]:bg-orange-500">
  <span class="... group-data-[checked]:translate-x-6" />
</Switch>`,
            <div class="flex items-center gap-3">
              <Switch
                bind={this.airplane}
                class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-slate-300 transition-colors data-[checked]:bg-orange-500"
              >
                <span class="inline-block h-4 w-4 translate-x-1 rounded-full bg-white shadow transition-transform group-data-[checked]:translate-x-6" />
              </Switch>
              <span
                class="text-sm text-slate-600"
                x-text="$flow.airplane ? 'Airplane mode on' : 'Airplane mode off'"
              />
            </div>,
          )}

          {this.section(
            "Checkbox",
            "role=checkbox · group-data-[checked]:",
            `<Checkbox bind={this.newsletter} class="group ... data-[checked]:bg-orange-500">
  <svg class="hidden group-data-[checked]:block ..."> … </svg>
</Checkbox>`,
            <label class="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
              <Checkbox
                bind={this.newsletter}
                class="group flex h-5 w-5 items-center justify-center rounded border border-slate-300 transition-colors data-[checked]:border-orange-500 data-[checked]:bg-orange-500"
              >
                <svg
                  class="hidden h-3 w-3 text-white group-data-[checked]:block"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <path
                    d="M2 6l3 3 5-5"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </Checkbox>
              Subscribe to the newsletter
            </label>,
          )}

          {this.section(
            "Select",
            "native, themed, two-way bound",
            `<Select
  bind={this.fruit}
  placeholder="Pick a fruit"
  options={[
    { label: "Apple", value: "apple" },
    { label: "Banana", value: "banana" },
    { label: "Cherry", value: "cherry" },
  ]}
/>`,
            <Select
              bind={this.fruit}
              placeholder="Pick a fruit"
              class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-400 focus:outline-none"
              options={[
                { label: "Apple", value: "apple" },
                { label: "Banana", value: "banana" },
                { label: "Cherry", value: "cherry" },
              ]}
            />,
          )}

          {this.section(
            "Radio group",
            "role=radiogroup · data-[checked]: per option",
            `<RadioGroup
  bind={this.plan}
  optionClass="... data-[checked]:border-orange-400 data-[checked]:bg-orange-50"
  options={[
    { label: "Starter — $9/mo", value: "starter" },
    { label: "Pro — $29/mo", value: "pro" },
    { label: "Team — $99/mo", value: "team" },
  ]}
/>`,
            <RadioGroup
              bind={this.plan}
              class="space-y-2"
              optionClass="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-4 py-2.5 text-sm data-[checked]:border-orange-400 data-[checked]:bg-orange-50"
              options={[
                { label: "Starter — $9/mo", value: "starter" },
                { label: "Pro — $29/mo", value: "pro" },
                { label: "Team — $99/mo", value: "team" },
              ]}
            />,
          )}

          {this.section(
            "Listbox",
            "arrow keys · data-[active] / data-[selected]",
            `<Listbox
  bind={this.assignee}
  placeholder="Assign to…"
  optionClass="... data-[active]:bg-slate-100 data-[selected]:text-orange-600"
  options={[
    { label: "Ada Lovelace", value: "ada" },
    { label: "Alan Turing", value: "alan" },
    { label: "Grace Hopper", value: "grace" },
  ]}
/>`,
            <Listbox
              bind={this.assignee}
              placeholder="Assign to…"
              buttonClass="w-full rounded-lg border border-slate-300 px-3 py-2 text-left text-sm shadow-sm"
              optionsClass="mt-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
              optionClass={opt}
              options={[
                { label: "Ada Lovelace", value: "ada" },
                { label: "Alan Turing", value: "alan" },
                { label: "Grace Hopper", value: "grace" },
              ]}
            />,
          )}

          {this.section(
            "Combobox",
            "type to filter · autocomplete",
            `<Combobox
  bind={this.city}
  placeholder="Search a city…"
  options={cities}   // { label, value }[]
/>`,
            <Combobox
              bind={this.city}
              placeholder="Search a city…"
              optionClass={opt}
              options={[
                { label: "Cape Town", value: "cpt" },
                { label: "Nairobi", value: "nbo" },
                { label: "Lagos", value: "los" },
                { label: "Accra", value: "acc" },
                { label: "Kigali", value: "kgl" },
              ]}
            />,
          )}
        </div>

        {this.section(
          "Disclosure & accordion",
          "aria-expanded · data-[open]",
          `<Disclosure label="Refund policy">
  Full refund within 30 days.
</Disclosure>

<Accordion
  multiple
  items={[
    { label: "Shipping", content: "Ships in 1–2 business days." },
    { label: "Returns",  content: "Free returns within 30 days." },
  ]}
/>`,
          <div class="space-y-6">
            <Disclosure
              label="Refund policy"
              buttonClass="flex w-full items-center justify-between rounded-lg bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800"
              panelClass="px-4 py-3 text-sm text-slate-600"
            >
              Full refund within 30 days. No questions asked.
            </Disclosure>

            <Accordion
              multiple
              buttonClass="flex w-full items-center justify-between px-1 py-3 text-sm font-medium text-slate-800"
              panelClass="pb-3 text-sm text-slate-600"
              items={[
                { label: "Shipping", content: "Ships in 1–2 business days." },
                { label: "Returns", content: "Free returns within 30 days." },
                { label: "Warranty", content: "2-year manufacturer warranty." },
              ]}
            />
          </div>,
        )}

        <div class="space-y-6">
          {this.section(
            "Popover & tooltip",
            "click-open · hover/focus",
            `<Popover label="Solutions ▾">
  <a href="/analytics">Analytics</a>
  <a href="/reports">Reports</a>
</Popover>

<Tooltip content="Copy link" placement="top">
  <button>Hover me</button>
</Tooltip>`,
            <div class="flex flex-wrap items-center gap-4">
              <Popover
                label="Solutions ▾"
                class="relative inline-block"
                buttonClass="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm"
                panelClass="absolute z-10 mt-2 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
              >
                <a href="#" class="block rounded-md px-3 py-2 text-sm hover:bg-slate-100">
                  Analytics
                </a>
                <a href="#" class="block rounded-md px-3 py-2 text-sm hover:bg-slate-100">
                  Reports
                </a>
              </Popover>

              <Tooltip content="Copy link to clipboard" placement="top">
                <button class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm">
                  Hover me 🔗
                </button>
              </Tooltip>
            </div>,
          )}

          {this.section(
            "Field",
            "wires label · description · error a11y",
            `<Field label="Email" description="We'll never share it.">
  <input type="email" class="input" />
</Field>`,
            <Field label="Email" description="We'll never share it.">
              <input
                type="email"
                placeholder="you@example.com"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-orange-400 focus:outline-none"
              />
            </Field>,
          )}
        </div>
      </div>
    );
  }
}
