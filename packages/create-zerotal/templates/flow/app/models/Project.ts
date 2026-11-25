import { Model, column, table } from "zerotal/orm";

/** The stages a project moves through, in order. */
export const PROJECT_STATUSES = ["planning", "active", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 * The example resource: something a signed-in user creates, lists, edits and deletes.
 * Only its owner can see or change it (app/policies/ProjectPolicy.ts).
 *
 * The README's "Remove the example" section lists every file that belongs to it.
 */
@table("projects")
export class Project extends Model {
  // Mass-assignable from a form. The owner is not on this list: it is set in code,
  // from the signed-in user, so no form field can hand a project to someone else.
  static override fillable = ["name", "description", "status"] as const;

  @column({ type: "number" }) userId!: number;
  @column({ type: "string" }) name!: string;
  @column({ type: "text", nullable: true }) description?: string | null | undefined;
  @column({ type: "string", default: "planning" }) status!: ProjectStatus;

  /** What a page is sent: the fields it shows, as plain JSON. */
  toPage(): ProjectData {
    const updated = (this as { updatedAt?: { toISOString?(): string } | string }).updatedAt;
    return {
      id: this.id,
      name: this.name,
      description: this.description ?? null,
      status: this.status,
      updatedAt: typeof updated === "string" ? updated : (updated?.toISOString?.() ?? null),
    };
  }
}

/** A project as the pages show it. */
export interface ProjectData {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  updatedAt: string | null;
}
