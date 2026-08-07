/** @jsxImportSource @zerotal/flow */
// Roles and permissions — a matrix of every ability the panel checks against
// every role, with the whole grid editable in place. Appears only when the panel
// has a role provider configured.

import { Component, expose } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { AdminLayout } from "../ui/AdminLayout.tsx";
import { Icon } from "../ui/icons.tsx";
import { Panel } from "../Panel.ts";
import type { PanelInstance } from "../PanelInstance.ts";
import type { Permission, Role } from "../roles.ts";
import { groupPermissions, panelPermissions, roleHas } from "../roles.ts";

export class RolesPage extends Component {
  static layout = AdminLayout;
  /** The panel this page belongs to — set by each generated subclass. */
  static panel: PanelInstance;

  /** A new role's details, while the create form is open. */
  @expose creating = false;
  @expose newName = "";
  @expose newDescription = "";

  private get _panel(): PanelInstance {
    return (this.constructor as typeof RolesPage).panel ?? Panel.current();
  }

  private _roles: Role[] = [];
  private _held: Record<string, string[]> = {};
  private _permissions: Permission[] = [];

  /**
   * Turn one permission on or off for one role.
   *
   * The provider is given the role's complete new set rather than a delta, so a
   * concurrent edit cannot leave a role holding half of two different answers.
   */
  @expose async toggle(roleId: unknown, key: unknown): Promise<void> {
    const provider = this._panel.roleProvider();
    const role = this._roles.find((r) => r.id === String(roleId));
    if (!provider || !role) return;
    // A superuser's permissions are not a set to edit — they are "everything".
    if (role.superuser) {
      this.flash(`${role.name} holds every permission by definition.`, "warning");
      return;
    }

    const current = this._held[role.id] ?? [];
    const permission = String(key);
    const next = current.includes(permission)
      ? current.filter((k) => k !== permission)
      : [...current, permission];

    await provider.setPermissions(role.id, next);
    this._held[role.id] = next;
  }

  /** Grant or revoke a whole resource's abilities at once. */
  @expose async toggleGroup(roleId: unknown, group: unknown): Promise<void> {
    const provider = this._panel.roleProvider();
    const role = this._roles.find((r) => r.id === String(roleId));
    if (!provider || !role || role.superuser) return;

    const keys = this._permissions.filter((p) => p.group === String(group)).map((p) => p.key);
    const current = this._held[role.id] ?? [];
    // Partly-ticked counts as off, so one click fills the group rather than
    // clearing the few that were already set.
    const all = keys.every((k) => current.includes(k));
    const next = all
      ? current.filter((k) => !keys.includes(k))
      : [...new Set([...current, ...keys])];

    await provider.setPermissions(role.id, next);
    this._held[role.id] = next;
  }

  @expose openCreate(): void {
    this.creating = true;
    this.newName = "";
    this.newDescription = "";
  }

  @expose cancelCreate(): void {
    this.creating = false;
  }

  @expose async createRole(): Promise<void> {
    const provider = this._panel.roleProvider();
    if (!provider?.create || !this.newName.trim()) return;
    await provider.create({
      name: this.newName.trim(),
      ...(this.newDescription.trim() ? { description: this.newDescription.trim() } : {}),
    });
    this.creating = false;
    this.flash(`${this.newName.trim()} created.`, "success");
  }

  @expose async removeRole(roleId: unknown): Promise<void> {
    const provider = this._panel.roleProvider();
    const role = this._roles.find((r) => r.id === String(roleId));
    if (!provider?.remove || !role) return;
    await provider.remove(role.id);
    this.flash(`${role.name} deleted.`, "success");
  }

  override async render(): Promise<HtmlNode> {
    const provider = this._panel.roleProvider();
    const base = this._panel.base();

    this._permissions = panelPermissions(this._panel);
    this._roles = provider ? await provider.list() : [];
    this._held = {};
    for (const [id, keys] of await Promise.all(
      this._roles.map(async (r) => [r.id, await provider!.permissionsFor(r.id)] as const),
    )) {
      this._held[id] = keys;
    }

    const groups = groupPermissions(this._permissions);
    const canCreate = !!provider?.create;
    const canRemove = !!provider?.remove;

    return (
      <div class="space-y-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <nav class="mb-1 text-xs text-muted-foreground">
              <a href={base} navigate class="hover:text-foreground">
                Dashboard
              </a>
              <span class="mx-1">/</span>
              <span>Roles</span>
            </nav>
            <h1 class="text-2xl font-semibold tracking-tight">Roles &amp; permissions</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              Every ability this panel checks, and which roles hold it. Changes apply immediately.
            </p>
          </div>
          {canCreate && !this.creating ? (
            <button
              type="button"
              onClick={this.openCreate}
              class="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Icon name="plus" class="h-4 w-4" />
              New role
            </button>
          ) : null}
        </div>

        {this.creating ? (
          <div class="space-y-3 rounded-lg border border-border bg-card p-4">
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="mb-1 block text-xs font-medium">Name</span>
                <input
                  {...{ "flow:model": "newName" }}
                  placeholder="Editor"
                  class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label class="block">
                <span class="mb-1 block text-xs font-medium">Description</span>
                <input
                  {...{ "flow:model": "newDescription" }}
                  placeholder="Can publish, but not delete"
                  class="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={this.createRole}
                class="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Create
              </button>
              <button
                type="button"
                onClick={this.cancelCreate}
                class="inline-flex h-9 items-center rounded-lg border border-input px-4 text-sm font-medium transition hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {!provider ? (
          <div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No role provider is configured for this panel.
          </div>
        ) : this._roles.length === 0 ? (
          <div class="rounded-lg border border-dashed border-border p-10 text-center">
            <Icon name="shield" class="mx-auto h-8 w-8 text-muted-foreground" />
            <p class="mt-3 text-sm font-medium">No roles yet</p>
            <p class="mt-1 text-sm text-muted-foreground">
              Create one, and every ability below becomes assignable.
            </p>
          </div>
        ) : (
          <div class="overflow-x-auto rounded-lg border border-border">
            <table class="w-full text-sm">
              <thead class="bg-muted/40">
                <tr>
                  <th
                    scope="col"
                    class="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium"
                  >
                    Permission
                  </th>
                  {this._roles.map((role) => (
                    <th scope="col" class="px-3 py-2 text-center font-medium">
                      <div class="flex flex-col items-center gap-0.5">
                        <span class="flex items-center gap-1">
                          {role.superuser ? (
                            <Icon name="shield" class="h-3.5 w-3.5 text-primary" />
                          ) : null}
                          {role.name}
                        </span>
                        {role.description ? (
                          <span class="text-[11px] font-normal text-muted-foreground">
                            {role.description}
                          </span>
                        ) : null}
                        {canRemove && !role.superuser ? (
                          <button
                            type="button"
                            onClick={this.removeRole}
                            data-args={JSON.stringify([role.id])}
                            confirm={`Delete the ${role.name} role? Anyone holding it loses its permissions.`}
                            class="text-[11px] font-normal text-destructive hover:underline"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <>
                    <tr class="border-t border-border bg-muted/20">
                      <th
                        scope="rowgroup"
                        class="sticky left-0 z-10 bg-muted/20 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {group.group}
                      </th>
                      {this._roles.map((role) => {
                        const keys = group.items.map((p) => p.key);
                        const held = this._held[role.id] ?? [];
                        const all = role.superuser || keys.every((k) => held.includes(k));
                        return (
                          <td class="px-3 py-1.5 text-center">
                            {/* One click for the whole block — the common case is
                                granting a role a resource, not one ability of it. */}
                            <button
                              type="button"
                              onClick={this.toggleGroup}
                              data-args={JSON.stringify([role.id, group.group])}
                              disabled={role.superuser}
                              aria-label={`${all ? "Revoke" : "Grant"} all ${group.group} permissions for ${role.name}`}
                              class="text-[11px] text-muted-foreground transition hover:text-foreground disabled:opacity-40"
                            >
                              {all ? "none" : "all"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                    {group.items.map((permission) => (
                      <tr class="border-t border-border hover:bg-muted/30">
                        <td class="sticky left-0 z-10 bg-card px-3 py-1.5">
                          <span>{permission.label}</span>
                          <span class="ml-2 font-mono text-[11px] text-muted-foreground">
                            {permission.key}
                          </span>
                        </td>
                        {this._roles.map((role) => {
                          const on = roleHas(role, this._held[role.id] ?? [], permission.key);
                          return (
                            <td class="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={this.toggle}
                                data-args={JSON.stringify([role.id, permission.key])}
                                disabled={role.superuser}
                                role="switch"
                                aria-checked={on ? "true" : "false"}
                                aria-label={`${permission.label} for ${role.name}`}
                                class={`inline-flex h-5 w-5 items-center justify-center rounded border transition disabled:opacity-40 ${
                                  on
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-input hover:border-primary/50"
                                }`}
                              >
                                {on ? <Icon name="check" class="h-3.5 w-3.5" /> : null}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
}

/** Build a RolesPage bound to one panel. */
export function makeRolesPage(panel: PanelInstance = Panel.default()): typeof RolesPage {
  return class BoundRolesPage extends RolesPage {
    static override panel = panel;
  };
}
