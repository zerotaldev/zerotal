/**
 * The update path — the one that makes an audit trail worth having.
 *
 * `created` and `deleted` snapshot a single state, so they are hard to get
 * subtly wrong. An update is different: it is recorded in two phases, because
 * the old values only exist before the ORM overwrites `_original`. `saving`
 * stashes them in a WeakMap and `updated` consumes them.
 *
 * Everything that can go wrong there is silent. If the stash read the *new*
 * values, every row would show old and new identical and the trail would still
 * look populated. If the WeakMap were never consumed, one edit's old values
 * would attach to the next edit. Neither throws, and neither is visible without
 * reading the rows — which is exactly the kind of thing an audit log is supposed
 * to be trusted for.
 */
import { describe, it, expect } from "bun:test";
import { AuditObserver } from "./AuditObserver.ts";

interface Recorded {
  event: string;
  auditable_type: string;
  auditable_id: string | null;
  old_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
}

function fakeAuditor(): { payloads: Recorded[]; _recordModel: (p: Recorded) => Promise<void> } {
  const payloads: Recorded[] = [];
  return {
    payloads,
    _recordModel: async (p: Recorded) => {
      payloads.push(p);
    },
  };
}

/**
 * A model stand-in shaped like the ORM's: `_original` holds the loaded values,
 * the instance properties hold the current ones, and `$dirty()` reports what
 * changed — which is the contract the observer reads.
 */
function model(
  original: Record<string, unknown>,
  changes: Record<string, unknown>,
  extra: { exists?: boolean; statics?: Record<string, unknown> } = {},
) {
  const Ctor = class Post {
    static auditExcept?: string[];
    static auditOnly?: string[];
    id = 1;
    _exists = extra.exists ?? true;
    _original = { ...original };
    $dirty() {
      return { ...changes };
    }
    toJSON() {
      return { ...original, ...changes };
    }
  };
  Object.assign(Ctor, extra.statics ?? {});
  const m = new Ctor();
  Object.assign(m, original, changes);
  return m as unknown as never;
}

describe("AuditObserver — updates", () => {
  it("records the value as it was, not as it became", async () => {
    // The whole point. If `saving` read current state instead of `_original`,
    // old and new would match and every row would be uninformative.
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model({ title: "Draft" }, { title: "Published" });

    await o.saving(m);
    await o.updated(m);

    expect(a.payloads).toHaveLength(1);
    expect(a.payloads[0]!.event).toBe("updated");
    expect(a.payloads[0]!.old_values).toEqual({ title: "Draft" });
    expect(a.payloads[0]!.new_values).toEqual({ title: "Published" });
  });

  it("records only the columns that changed", async () => {
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model({ title: "Draft", body: "unchanged" }, { title: "Published" });

    await o.saving(m);
    await o.updated(m);

    expect(a.payloads[0]!.old_values).toEqual({ title: "Draft" });
    expect(a.payloads[0]!.new_values).toEqual({ title: "Published" });
  });

  it("records nothing when nothing is dirty", async () => {
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model({ title: "Draft" }, {});

    await o.saving(m);
    await o.updated(m);

    expect(a.payloads).toHaveLength(0);
  });

  it("skips the stash entirely on a create", async () => {
    // A model that does not yet exist has no previous values; stashing here
    // would attach an empty old_values to the row `created` already recorded.
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model({}, { title: "New" }, { exists: false });

    await o.saving(m);
    await o.updated(m);

    expect(a.payloads).toHaveLength(0);
  });

  it("consumes the stash, so a second update without a save records nothing", async () => {
    // If the WeakMap entry survived, one edit's old values would be reported
    // again against a later, unrelated write.
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model({ title: "Draft" }, { title: "Published" });

    await o.saving(m);
    await o.updated(m);
    await o.updated(m);

    expect(a.payloads).toHaveLength(1);
  });

  it("keeps two models' stashes apart", async () => {
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const first = model({ title: "A-old" }, { title: "A-new" });
    const second = model({ title: "B-old" }, { title: "B-new" });

    // Interleaved, as concurrent requests would be.
    await o.saving(first);
    await o.saving(second);
    await o.updated(second);
    await o.updated(first);

    expect(a.payloads.map((p) => p.old_values)).toEqual([{ title: "B-old" }, { title: "A-old" }]);
  });
});

describe("AuditObserver — updates honour the column filters", () => {
  it("scrubs an excluded column from both sides of the record", async () => {
    // Recording the old password while scrubbing the new one would defeat the
    // exclusion entirely, so both sides have to be filtered.
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model(
      { password: "old-hash", title: "Draft" },
      { password: "new-hash", title: "Published" },
      { statics: { auditExcept: ["password"] } },
    );

    await o.saving(m);
    await o.updated(m);

    expect(a.payloads[0]!.old_values).toEqual({ title: "Draft" });
    expect(a.payloads[0]!.new_values).toEqual({ title: "Published" });
  });

  it("records nothing when every changed column is excluded", async () => {
    // An empty row would claim an edit happened while showing no fields — worse
    // than no row, because it implies the trail captured something.
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model(
      { password: "old-hash" },
      { password: "new-hash" },
      { statics: { auditExcept: ["password"] } },
    );

    await o.saving(m);
    await o.updated(m);

    expect(a.payloads).toHaveLength(0);
  });

  it("respects an allowlist", async () => {
    const a = fakeAuditor();
    const o = new AuditObserver(a as never);
    const m = model(
      { title: "Draft", body: "x" },
      { title: "Published", body: "y" },
      { statics: { auditOnly: ["title"] } },
    );

    await o.saving(m);
    await o.updated(m);

    expect(a.payloads[0]!.old_values).toEqual({ title: "Draft" });
    expect(a.payloads[0]!.new_values).toEqual({ title: "Published" });
  });
});
