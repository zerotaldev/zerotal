// A model prop used to cross the wire as its id alone, so `this.user.name` had nothing to
// bind to on the client. It now carries the model's display surface, which makes the fields
// readable and — where the model allows it — editable.
//
// Two questions, two allow-lists, and conflating them is the bug this file guards:
//
//   what may be SHOWN    → `toJSON()`, i.e. `visible` / `hidden`
//   what may be WRITTEN  → `fillable` (hidden is not subtracted — a password is both)
//
// Using the writable set for both would make `@locked` pointless: a read-only display model
// declares no `fillable`, so it would arrive as a bare id — and a prop that puts nothing on
// the client is what `@transient` is for.
import { describe, it, expect } from "bun:test";
import { serializeValue } from "./index.ts";
import {
  _pendingSecretKeys,
  _writableFields,
  _applyWireValues,
  _restoreSnapshotValues,
  _isModel,
  _modelKey,
} from "./ModelSynth.ts";

function serialise(model: object, hidden: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(model)) {
    if (hidden.includes(k) || k === "filled" || k === "_original") continue;
    out[k] = v;
  }
  return out;
}

/** Editable: a writable subset, plus server-owned columns that are display-only. */
class User {
  static table = "users";
  static fillable = ["name", "email", "password"] as const;
  static hidden = ["password"] as const;

  id = 42;
  name = "Ada";
  email = "ada@example.test";
  role = "admin"; // display-only — never fillable
  password = "$2b$10$secret";

  filled: Record<string, unknown> | null = null;
  fill(values: Record<string, unknown>): this {
    this.filled = values;
    Object.assign(this, values);
    return this;
  }

  _original: Record<string, unknown> = { name: "Ada", email: "ada@example.test" };
  $dirty(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of ["name", "email"]) {
      const cur = (this as unknown as Record<string, unknown>)[k];
      if (cur !== this._original[k]) out[k] = cur;
    }
    return out;
  }
  toJSON(): Record<string, unknown> {
    return serialise(this, User.hidden);
  }
}

/** Read-only: nothing is user-writable, so nothing is fillable. The `@locked` case. */
class Report {
  static table = "reports";
  static hidden = ["internalNote"] as const;

  id = 9;
  title = "Q3";
  total = 1200;
  internalNote = "not for the browser";

  fill(): this {
    return this;
  }
  toJSON(): Record<string, unknown> {
    return serialise(this, Report.hidden);
  }
}

// Deliberately NOT registered. A model travels under its table name, which every model
// already declares, so nothing has to be wired up per component.

describe("_writableFields", () => {
  it("is fillable — hidden is not subtracted", () => {
    // The two allow-lists answer different questions. A password is fillable because a user
    // sets it and hidden because the stored hash must never be shown; subtracting made it
    // unwritable, so a bound password field silently did nothing.
    expect(_writableFields(User as never)).toEqual(["name", "email", "password"]);
  });

  it("is empty when the model declares no fillable", () => {
    // The ORM guards mass assignment by default; such a model is readable, never editable.
    expect(_writableFields(Report as never)).toEqual([]);
  });
});

describe("what reaches the client", () => {
  it("never includes a hidden field", () => {
    // The regression that matters: `password` is fillable *and* hidden.
    const [data] = serializeValue(new User());
    expect(JSON.stringify(data)).not.toContain("secret");
    expect(data).not.toHaveProperty("password");
  });

  it("includes display-only columns the client cannot write", () => {
    const [data] = serializeValue(new User());
    expect(data).toMatchObject({ name: "Ada", role: "admin" });
  });

  it("gives a read-only model its fields, not a bare id", () => {
    // The `@locked` case. Sending only the id would make the decorator useless — that is
    // what `@transient` means.
    const [data] = serializeValue(new Report());
    expect(data).toMatchObject({ title: "Q3", total: 1200 });
    expect(data).not.toHaveProperty("internalNote");
  });

  it("puts the identity in meta, which the write channel cannot reach", () => {
    const [, meta] = serializeValue(new User());
    expect(meta).toMatchObject({ s: "mdl", class: "users", id: 42 });
  });
});

describe("what the client may write back", () => {
  it("applies a writable field", () => {
    const u = new User();
    _applyWireValues(u, { name: "Grace" });
    expect(u.name).toBe("Grace");
  });

  it("ignores a display-only field rather than throwing", () => {
    // `fill()` throws MassAssignmentError off `fillable`; this data is from the browser, so
    // a hostile payload must be ignored, not turned into a 500.
    const u = new User();
    expect(() => _applyWireValues(u, { role: "superuser" })).not.toThrow();
    expect(u.role).toBe("admin");
    expect(u.filled).toBeNull();
  });

  it("accepts a hidden field that is fillable", () => {
    // Writable, because `hidden` is about display. It is never *sent* unless the client
    // supplied it — see the pending-secret tests below.
    const u = new User();
    _applyWireValues(u, { password: "hunter2" });
    expect(u.password).toBe("hunter2");
  });

  it("cannot rewrite the identity", () => {
    const u = new User();
    _applyWireValues(u, { id: 999, name: "Grace" });
    expect(u.id).toBe(42);
    expect(u.name).toBe("Grace");
  });

  it("accepts nothing at all for a model with no fillable", () => {
    const r = new Report();
    _applyWireValues(r, { title: "tampered" });
    expect(r.title).toBe("Q3");
  });

  it("does nothing for a non-object payload", () => {
    const u = new User();
    for (const bad of [null, 5, "x", [1, 2]]) {
      expect(() => _applyWireValues(u, bad)).not.toThrow();
    }
    expect(u.filled).toBeNull();
  });
});

describe("restoring the state we last had", () => {
  it("brings back an unsaved change, so a field does not revert", () => {
    // An action set `name` and did not save. The snapshot is HMAC-signed, so that value is
    // the server's own last output — restoring it is picking up where we left off, not
    // trusting the browser. Without this the field reverts the next time anything happens.
    const edited = new User();
    edited.name = "Grace";
    const [data] = serializeValue(edited);

    const fetched = new User(); // findOrFail: name is still "Ada" in the database
    _restoreSnapshotValues(fetched, data);

    expect(fetched.name).toBe("Grace");
  });

  it("leaves display-only columns to the fetched row", () => {
    // `role` is server-owned. Nothing in a round-trip can change it, so carrying it forward
    // from a snapshot could only replace a current value with an older one. The class stays
    // as the database has it.
    const before = new User();
    before.role = "editor";
    const [data] = serializeValue(before);

    const fetched = new User(); // findOrFail: role is "admin" in the database
    _restoreSnapshotValues(fetched, data);

    expect(fetched.role).toBe("admin");
    expect(fetched.name).toBe("Ada"); // untouched writable field, unchanged either way
  });

  it("restores a writable field that was edited", () => {
    const before = new User();
    before.name = "Grace";
    before.role = "editor";
    const [data] = serializeValue(before);

    const fetched = new User();
    _restoreSnapshotValues(fetched, data);

    expect(fetched.name).toBe("Grace"); // the edit survives
    expect(fetched.role).toBe("admin"); // the server-owned column does not
  });

  it("never rewrites the identity", () => {
    const fetched = new User();
    _restoreSnapshotValues(fetched, { id: 999, name: "Grace" });
    expect(fetched.id).toBe(42);
    expect(fetched.name).toBe("Grace");
  });

  it("ignores keys the instance does not already carry", () => {
    // An `appends` entry or a computed accessor in toJSON() output must not create or
    // overwrite a real property.
    const fetched = new User();
    _restoreSnapshotValues(fetched, { notAColumn: "x", _original: "tampered" });
    expect(fetched).not.toHaveProperty("notAColumn");
    expect(fetched._original).toEqual({ name: "Ada", email: "ada@example.test" });
  });

  it("does nothing for a non-object payload", () => {
    const fetched = new User();
    for (const bad of [null, 5, "x", [1, 2]]) {
      expect(() => _restoreSnapshotValues(fetched, bad)).not.toThrow();
    }
    expect(fetched.name).toBe("Ada");
  });
});

describe("restore and update are different channels", () => {
  it("both are bounded by the writable set, for different reasons", () => {
    // Restore carries the component's own last state; update carries client intent. Neither
    // may touch a server-owned column, so `role` survives as the database has it.
    const a = new User();
    _restoreSnapshotValues(a, { role: "editor", name: "Grace" });
    expect(a.role).toBe("admin");
    expect(a.name).toBe("Grace");

    const b = new User();
    _applyWireValues(b, { role: "editor", name: "Grace" });
    expect(b.role).toBe("admin");
    expect(b.name).toBe("Grace");
  });
});

describe("recognising a model without being told", () => {
  it("matches on the table name every model already has", () => {
    expect(_isModel(new User())).toBe(true);
    expect(_modelKey(User as never)).toBe("users");
  });

  it("does not mistake a plain object for a model", () => {
    expect(_isModel({ id: 1, name: "Ada" })).toBe(false);
    expect(_isModel(null)).toBe(false);
    expect(_isModel("x")).toBe(false);
  });

  it("an unregistered model does not leak its hidden columns", () => {
    // This is the regression. Requiring registration meant a model nobody declared fell
    // through to the generic serializer, which walks properties and never calls `toJSON()` —
    // so `hidden` was bypassed and every column reached the browser. It failed on the second
    // interaction, never the first, and FlowTest does not round-trip through a synth, so only
    // a browser ever saw it.
    const [data, meta] = serializeValue(new User());
    expect(JSON.stringify(data)).not.toContain("secret");
    expect(meta).toMatchObject({ s: "mdl", class: "users" });
  });
});

describe("nested relations", () => {
  class Author {
    static table = "authors";
    static hidden = ["password"] as const;
    id = 7;
    name = "Ada";
    password = "$2b$10$SECRET";
    toJSON(): Record<string, unknown> {
      return serialise(this, Author.hidden);
    }
  }

  class Article {
    static table = "articles";
    id = 1;
    title = "Hi";
    author = new Author();
    contributors = [new Author()];
    toJSON(): Record<string, unknown> {
      return serialise(this, []);
    }
  }

  it("resolves a nested model through its own toJSON", () => {
    // `BaseModel.toJSON()` assigns relations by reference, so `author` arrives as a live
    // model. Its hidden columns only survived because whatever stringified the snapshot
    // honoured the `toJSON` contract — an implicit guarantee holding up a security property.
    const [data] = serializeValue(new Article());
    expect(JSON.stringify(data)).not.toContain("SECRET");
    expect((data as Record<string, unknown>)["author"]).toEqual({ id: 7, name: "Ada" });
  });

  it("resolves models nested inside an array", () => {
    const [data] = serializeValue(new Article());
    expect((data as Record<string, unknown[]>)["contributors"]).toEqual([{ id: 7, name: "Ada" }]);
  });

  it("survives a relation cycle", () => {
    // post.author.posts[0].author … — a loaded graph can point back at itself.
    const a = new Author() as Author & { self?: unknown };
    a.self = a;
    expect(() => serializeValue(a)).not.toThrow();
  });
});

describe("a hidden field the client is typing", () => {
  it("is not sent until the client supplies one", () => {
    // The stored hash never leaves. That is what `hidden` is for.
    const [data, meta] = serializeValue(new User());
    expect(data).not.toHaveProperty("password");
    expect(meta).not.toHaveProperty("p");
  });

  it("is writable — hidden governs display, not writes", () => {
    // Subtracting `hidden` from the write set made a bound password field silently do
    // nothing, which is worse than refusing it.
    const u = new User();
    _applyWireValues(u, { password: "hunter2" });
    expect(u.password).toBe("hunter2");
  });

  it("travels back once the client has supplied it", () => {
    // Echoing what the browser just typed tells it nothing it does not already have, and
    // without this the field empties itself on the next interaction.
    const u = new User();
    _applyWireValues(u, { password: "hunter2" });

    expect(_pendingSecretKeys(u)).toEqual(["password"]);
    const [data, meta] = serializeValue(u);
    expect((data as Record<string, unknown>)["password"]).toBe("hunter2");
    expect((meta as Record<string, unknown>)["p"]).toEqual(["password"]);
  });

  it("does not echo a value the server produced", () => {
    // A rotated secret or a generated token is not the client's to receive. Only what came
    // back through an update is marked, which is why this tracks applied keys rather than
    // asking `$dirty()`.
    const u = new User();
    u.password = "server-generated-token";
    const [data, meta] = serializeValue(u);
    expect(data).not.toHaveProperty("password");
    expect(meta).not.toHaveProperty("p");
  });
});
