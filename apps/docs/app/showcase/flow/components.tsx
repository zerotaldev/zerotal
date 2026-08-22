/** @jsxImportSource @zerotal/flow */
import { Component, expose, Modal, Drawer, Dropdown, Tabs, Switch } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { ShowcaseLayout } from "../ShowcaseLayout.tsx";
import { Demo } from "../Demo.tsx";

/**
 * The batteries-included component kit. Overlays, menus, tabbed panels and a headless
 * toggle — all driven by one bound prop or entirely client-side, no wiring. Opening a
 * modal, switching a tab, toggling the switch: none of it round-trips. Each demo shows the
 * live component with its usage code below.
 */
export class ComponentsPage extends Component {
  static title = "Components — Flow showcase";

  @expose modalOpen = false;
  @expose drawerOpen = false;
  @expose notifications = true;

  override layout(page: HtmlNode): HtmlNode {
    return <ShowcaseLayout>{page}</ShowcaseLayout>;
  }

  private section(label: string, code: string, body: HtmlNode): HtmlNode {
    return (
      <div>
        <p class="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <Demo code={code}>{body}</Demo>
      </div>
    );
  }

  override async render(): Promise<HtmlNode> {
    const btn =
      "rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-orange-300 hover:text-orange-600";

    return (
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-slate-900">Components</h1>
          <p class="mt-1 max-w-2xl text-sm text-slate-500">
            Ready-made native components ship with Flow. Each is a real component — but the
            interaction here (open, close, switch tabs, toggle) is client-side, so it's instant.
          </p>
        </div>

        {this.section(
          "Overlays — Modal & Drawer",
          `@expose modalOpen = false;
@expose drawerOpen = false;

<button onClick={() => this.modalOpen = true}>Open modal</button>
<button onClick={() => this.drawerOpen = true}>Open drawer</button>

// bundle visibility, backdrop, close button and Escape — one boolean prop
<Modal show={this.modalOpen} title="Edit contact">…</Modal>
<Drawer show={this.drawerOpen} side="right" title="Your cart">…</Drawer>`,
          <div class="flex flex-wrap gap-3">
            <button onClick={() => (this.modalOpen = true)} class={btn}>
              Open modal
            </button>
            <button onClick={() => (this.drawerOpen = true)} class={btn}>
              Open drawer
            </button>
          </div>,
        )}

        {this.section(
          "Menu — Dropdown",
          `<Dropdown label="Options ▾" align="left">
  <button>Profile</button>
  <button>Settings</button>
  <button class="text-red-600">Sign out</button>
</Dropdown>`,
          <Dropdown
            label="Options ▾"
            align="left"
            panelClass="mt-2 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
          >
            <button class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">
              Profile
            </button>
            <button class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">
              Settings
            </button>
            <button class="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-slate-100">
              Sign out
            </button>
          </Dropdown>,
        )}

        {this.section(
          "Toggle — Switch",
          `@expose notifications = true;

<Switch bind={this.notifications} class="... data-[checked]:bg-orange-500">
  <span class="... group-data-[checked]:translate-x-6" />
</Switch>`,
          <div class="flex items-center gap-3">
            <Switch
              bind={this.notifications}
              aria-label="Email notifications"
              class="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-300 transition data-[checked]:bg-orange-500"
            >
              <span class="inline-block h-4 w-4 translate-x-1 rounded-full bg-white transition group-data-[checked]:translate-x-6" />
            </Switch>
            <span
              class="text-sm text-slate-600"
              x-text="$flow.notifications ? 'Notifications on' : 'Notifications off'"
            />
          </div>,
        )}

        {this.section(
          "Tabs",
          `<Tabs items={[
  { label: "Overview", content: <p>…</p> },
  { label: "Activity", content: <p>…</p> },
  { label: "Settings", content: <p>…</p> },
]} />`,
          <Tabs
            items={[
              {
                label: "Overview",
                content: (
                  <p class="pt-3 text-sm text-slate-600">
                    Client-side tabbed panels with roving arrow-key navigation and the right ARIA
                    roles.
                  </p>
                ),
              },
              {
                label: "Activity",
                content: (
                  <p class="pt-3 text-sm text-slate-600">
                    Switching tabs never touches the server — it's pure client state.
                  </p>
                ),
              },
              {
                label: "Settings",
                content: (
                  <p class="pt-3 text-sm text-slate-600">Every panel is just JSX you pass in.</p>
                ),
              },
            ]}
          />,
        )}

        <Modal show={this.modalOpen} title="Edit contact">
          <p class="text-sm text-slate-600">
            A dialog that bundles reactive visibility, a backdrop, a panel, a close button and
            Escape-to-close — all wired to one boolean prop. Click the backdrop, the ×, or press
            Escape to close (no round-trip).
          </p>
          <div class="mt-5 flex justify-end">
            <button
              onClick={() => (this.modalOpen = false)}
              class="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white"
            >
              Done
            </button>
          </div>
        </Modal>

        <Drawer show={this.drawerOpen} side="right" title="Your cart" class="w-96">
          <p class="text-sm text-slate-600">
            The edge-anchored sibling of the modal — same binding and close model, slides in from a
            side. Focus-trapped, Escape closes it.
          </p>
        </Drawer>
      </div>
    );
  }
}
