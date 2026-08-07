/**
 * Relation managers — related-record tables shown on a record's View page.
 * A HasMany relation renders the children as a table that links into their own
 * resource, so full CRUD lives there rather than being duplicated here.
 *
 *   class UserResource extends Resource {
 *     static relations() {
 *       return [hasMany(PostResource, "user_id").title("Posts")];
 *     }
 *   }
 */
import type { ResourceClass } from "../Panel.ts";

export type RelationKind = "hasMany" | "belongsToMany";

/** A pivot-table column surfaced on a BelongsToMany relation table. */
export interface PivotColumn {
  key: string;
  label?: string;
}

export class RelationManager {
  /** @internal */ _resource: ResourceClass;
  /** @internal HasMany: the child's foreign-key column. */
  _foreignKey: string;
  /** @internal */ _kind: RelationKind = "hasMany";
  /** @internal BelongsToMany: the relationship method on the parent model. */
  _relationName?: string;
  /** @internal BelongsToMany: pivot columns to display. */
  _pivotColumns: PivotColumn[] = [];
  /** @internal BelongsToMany: max related options offered in the Attach select. */
  _attachLimit = 50;
  /** @internal */ _title?: string;
  /** @internal */ _icon?: string;
  /** @internal */ _perPage = 10;
  /** @internal */ _canCreate = true;
  /** @internal BelongsToMany: allow attach/detach. */
  _canAttach = true;

  constructor(resource: ResourceClass, foreignKey: string) {
    this._resource = resource;
    this._foreignKey = foreignKey;
  }

  title(title: string): this {
    this._title = title;
    return this;
  }

  /** Disable the "New" button for this relation (HasMany). */
  canCreate(value: boolean): this {
    this._canCreate = value;
    return this;
  }

  /** Disable attach/detach (BelongsToMany). */
  canAttach(value: boolean): this {
    this._canAttach = value;
    return this;
  }

  icon(name: string): this {
    this._icon = name;
    return this;
  }

  perPage(n: number): this {
    this._perPage = Math.max(1, n);
    return this;
  }

  /** Pivot columns to show on a BelongsToMany table (read from `row.pivot`). */
  pivotColumns(columns: PivotColumn[]): this {
    this._pivotColumns = columns;
    return this;
  }

  /** Cap the number of options listed in the Attach select. */
  attachLimit(n: number): this {
    this._attachLimit = Math.max(1, n);
    return this;
  }

  isBelongsToMany(): boolean {
    return this._kind === "belongsToMany";
  }

  getTitle(): string {
    return this._title ?? this._resource.getPluralLabel();
  }
}

/** A HasMany relation manager (children referencing the parent via `foreignKey`). */
export function hasMany(resource: ResourceClass, foreignKey: string): RelationManager {
  return new RelationManager(resource, foreignKey);
}

/**
 * A BelongsToMany relation manager. `relationName` is the relationship method on
 * the *parent* model (e.g. `"roles"`) — its `attach()`/`detach()`/`get()` drive
 * the pivot. Renders the attached records with Detach + an Attach picker.
 *
 *   class UserResource extends Resource {
 *     static relations() {
 *       return [belongsToMany(RoleResource, "roles").pivotColumns([{ key: "assigned_at" }])];
 *     }
 *   }
 */
export function belongsToMany(resource: ResourceClass, relationName: string): RelationManager {
  const rm = new RelationManager(resource, "");
  rm._kind = "belongsToMany";
  rm._relationName = relationName;
  return rm;
}
