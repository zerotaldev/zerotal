import type { ModelObserver } from "@zerotal/orm";
import type { Auditor } from "./Auditor.ts";
import type { BaseModel } from "@zerotal/orm";

type AnyModel = BaseModel & Record<string, unknown>;

/** Audit config resolved per event from the model's static fields. */
interface ResolvedAuditConfig {
  only?: string[] | undefined;
  except?: string[] | undefined;
  type: string;
}

/**
 * Observes ORM lifecycle hooks for an auditable model.
 * Registered automatically by `registerAudit()` (via the `Auditable` mixin).
 *
 * Implementation notes:
 *  - Config (`auditOnly` / `auditExcept` / `auditType`) and the logged type name
 *    are read from `model.constructor` PER EVENT, so a single observer serves every
 *    subclass and the concrete subclass's name + statics are always what get used.
 *  - `saving` captures old values BEFORE `_original` is patched by the ORM's save();
 *    they're stashed in a WeakMap and consumed in `updated`.
 *  - `toJSON()` is used for create/delete snapshots; it honours `hidden` and skips
 *    internal ORM state automatically.
 */
export class AuditObserver implements ModelObserver<AnyModel> {
  /** Stash old values between saving and updated. */
  private readonly _oldValueCache = new WeakMap<AnyModel, Record<string, unknown>>();

  constructor(private readonly auditor: Auditor) {}

  // ── ORM hooks ─────────────────────────────────────────────────────────────

  async created(model: AnyModel): Promise<void> {
    const cfg = this._config(model);
    await this.auditor._recordModel({
      event: "created",
      auditable_type: cfg.type,
      auditable_id: model.id != null ? String(model.id) : null,
      new_values: this._filter(model.toJSON(), cfg),
    });
  }

  /**
   * Capture the CURRENT (pre-update) values before the ORM overwrites
   * `_original`.  Only the dirty-column keys are needed.
   */
  async saving(model: AnyModel): Promise<void> {
    if (!(model as unknown as { _exists?: boolean })._exists) return; // skip on create

    // `$dirty()` returns camelCase { key: currentVal } for changed fields
    const dirty = model.$dirty() as Record<string, unknown>;
    if (Object.keys(dirty).length === 0) return;

    // Read the original values for those same keys
    const orig = (model as unknown as { _original: Record<string, unknown> })._original;
    const oldSnap: Record<string, unknown> = {};
    for (const k of Object.keys(dirty)) {
      oldSnap[k] = orig[k];
    }
    this._oldValueCache.set(model, oldSnap);
  }

  async updated(model: AnyModel): Promise<void> {
    const old = this._oldValueCache.get(model);
    this._oldValueCache.delete(model);

    if (!old || Object.keys(old).length === 0) return;

    // Build new-values snapshot from the model's current state for the same keys
    const neo: Record<string, unknown> = {};
    for (const k of Object.keys(old)) {
      neo[k] = (model as Record<string, unknown>)[k];
    }

    const cfg = this._config(model);
    const filteredOld = this._filter(old, cfg);
    const filteredNew = this._filter(neo, cfg);

    // Nothing to record after filtering (e.g. only hidden/excluded cols changed)
    if (Object.keys(filteredNew).length === 0) return;

    await this.auditor._recordModel({
      event: "updated",
      auditable_type: cfg.type,
      auditable_id: model.id != null ? String(model.id) : null,
      old_values: filteredOld,
      new_values: filteredNew,
    });
  }

  async deleted(model: AnyModel): Promise<void> {
    const cfg = this._config(model);
    await this.auditor._recordModel({
      event: "deleted",
      auditable_type: cfg.type,
      auditable_id: model.id != null ? String(model.id) : null,
      old_values: this._filter(model.toJSON(), cfg),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Resolve audit config from the concrete subclass's static fields. */
  private _config(model: AnyModel): ResolvedAuditConfig {
    const ctor = model.constructor as {
      name: string;
      auditOnly?: string[];
      auditExcept?: string[];
      auditType?: string;
    };
    return {
      only: ctor.auditOnly,
      except: ctor.auditExcept,
      type: ctor.auditType ?? ctor.name,
    };
  }

  /** Apply only/except filters to a key-value snapshot. */
  private _filter(
    data: Record<string, unknown>,
    cfg: ResolvedAuditConfig,
  ): Record<string, unknown> {
    const { only, except } = cfg;
    let keys = Object.keys(data);

    if (only && only.length > 0) {
      keys = keys.filter((k) => only.includes(k));
    } else if (except && except.length > 0) {
      keys = keys.filter((k) => !except.includes(k));
    }

    return Object.fromEntries(keys.map((k) => [k, data[k]]));
  }
}
