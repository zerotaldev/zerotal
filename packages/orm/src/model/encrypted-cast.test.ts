/**
 * Encrypted columns: ciphertext in the database, plaintext on the model.
 *
 * The properties that matter are the ones you cannot see by reading the model
 * back — that the column really is unreadable at rest, that a fresh IV means two
 * saves of the same value produce different bytes, and that a value the key
 * cannot open fails loudly instead of arriving somewhere as ciphertext. So every
 * test here checks the raw column with `DB.raw` alongside the model property.
 */
import { describe, it, expect, beforeAll } from "bun:test";
import { SQL } from "bun";
import { BaseModel } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { DB } from "../db/DB.ts";
import { _setDbConnection, _setBaseModelConnection } from "../index.ts";
import { EncryptedColumnError } from "../casts/encrypted.ts";
import { ModelInspector } from "../schema/ModelInspector.ts";
import { columnsFor } from "./decorators/_metadata.ts";
import { Crypt } from "@zerotal/core/security";

@table("clients")
class Client extends BaseModel {
  @column() name!: string;
  @column({ type: "text", nullable: true, cast: "encrypted" }) idNumber?: string;
  @column({ type: "text", nullable: true, cast: "encrypted:json" }) medical?: unknown;
}

/** The same columns, declared through the list form instead of per-column casts. */
@table("patients")
class Patient extends BaseModel {
  static override encryptable = ["idNumber", "notes"];

  @column() name!: string;
  @column({ type: "text", nullable: true }) idNumber?: string;
  @column({ type: "json", nullable: true }) notes?: unknown;
}

/** A subclass listing its own must not drop what the base marked encrypted. */
@table("patients")
class VipPatient extends Patient {
  static override encryptable = ["notes"];
}

/** The positional shorthand — no `type`/`cast` pair to get right. */
@table("shorthand_clients")
class ShorthandClient extends BaseModel {
  @column() name!: string;
  @column("encrypted", { nullable: true }) idNumber?: string;
}

beforeAll(async () => {
  Crypt.setKey("base64:" + Buffer.from("a".repeat(32)).toString("base64"));
  const conn = new SQL(":memory:");
  _setDbConnection(conn as never);
  _setBaseModelConnection(conn as never);
  await DB.raw(`CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, id_number TEXT, medical TEXT,
    created_at TEXT, updated_at TEXT)`);
  await DB.raw(`CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, id_number TEXT, notes TEXT,
    created_at TEXT, updated_at TEXT)`);
  await DB.raw(`CREATE TABLE shorthand_clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, id_number TEXT,
    created_at TEXT, updated_at TEXT)`);
});

/** The bytes actually in the column, bypassing the model entirely. */
async function rawColumn(tbl: string, col: string, id: number): Promise<string | null> {
  const rows = await DB.raw(`SELECT ${col} AS v FROM ${tbl} WHERE id = ${id}`);
  return (rows as Array<{ v: string | null }>)[0]?.v ?? null;
}

describe("cast: 'encrypted'", () => {
  it("stores ciphertext and reads back the plaintext", async () => {
    const c = new Client();
    c.name = "Thandi";
    c.idNumber = "8001015009087";
    await c.save();

    const stored = await rawColumn("clients", "id_number", c.id);
    expect(stored).not.toBe("8001015009087");
    expect(stored).not.toContain("8001015009087");
    expect(Crypt.decryptString(stored!)).toBe("8001015009087");

    const back = await Client.find(c.id);
    expect(back!.idNumber).toBe("8001015009087");
  });

  it("leaves the plaintext on the instance after save", async () => {
    // The difference from `hashable`, which overwrites the property in place. An
    // encrypted column is reversible, so clobbering the instance would be a
    // surprise with nothing to gain — and would put ciphertext in front of any
    // code that reads the model after saving it.
    const c = new Client();
    c.name = "Sipho";
    c.idNumber = "9202204720082";
    await c.save();

    expect(c.idNumber).toBe("9202204720082");
  });

  it("draws a fresh IV, so the same value never has the same ciphertext twice", async () => {
    const a = new Client();
    a.name = "A";
    a.idNumber = "0000000000000";
    await a.save();

    const b = new Client();
    b.name = "B";
    b.idNumber = "0000000000000";
    await b.save();

    const [ca, cb] = [
      await rawColumn("clients", "id_number", a.id),
      await rawColumn("clients", "id_number", b.id),
    ];
    // Identical ciphertext would leak which clients share an ID number — the
    // reason a deterministic scheme is not used, and the reason you cannot query.
    expect(ca).not.toBe(cb);
    expect(Crypt.decryptString(ca!)).toBe(Crypt.decryptString(cb!));
  });

  it("stores NULL rather than an encrypted empty for a null column", async () => {
    const c = new Client();
    c.name = "No ID";
    await c.save();

    expect(await rawColumn("clients", "id_number", c.id)).toBeNull();
    // Hydrates as null, the way any NULL column does — the cast passes null
    // straight through rather than encrypting one.
    expect((await Client.find(c.id))!.idNumber).toBeNull();
  });

  it("round-trips an empty string as an empty string", async () => {
    const c = new Client();
    c.name = "Blank";
    c.idNumber = "";
    await c.save();

    // Not collapsed to NULL: "" is a value someone assigned, distinct from absent.
    expect(await rawColumn("clients", "id_number", c.id)).not.toBeNull();
    expect((await Client.find(c.id))!.idNumber).toBe("");
  });

  it("does not rewrite the column when nothing changed", async () => {
    const c = new Client();
    c.name = "Stable";
    c.idNumber = "7001015009087";
    await c.save();
    const first = await rawColumn("clients", "id_number", c.id);

    c.name = "Stable Renamed";
    await c.save();

    // $dirty compares plaintext, so an untouched encrypted column is left alone.
    // Re-encrypting it on every unrelated save would churn the column and defeat
    // any storage-level dedupe or change-data-capture watching it.
    expect(await rawColumn("clients", "id_number", c.id)).toBe(first);
  });

  it("re-encrypts when the value does change", async () => {
    const c = new Client();
    c.name = "Changer";
    c.idNumber = "6001015009087";
    await c.save();
    const first = await rawColumn("clients", "id_number", c.id);

    c.idNumber = "6505055009087";
    await c.save();

    expect(await rawColumn("clients", "id_number", c.id)).not.toBe(first);
    expect((await Client.find(c.id))!.idNumber).toBe("6505055009087");
  });

  it("refuses a non-string rather than storing its String() form", async () => {
    const c = new Client();
    c.name = "Wrong type";
    (c as unknown as { idNumber: unknown }).idNumber = { id: 1 };

    // "[object Object]" would encrypt and decrypt perfectly, and be nonsense.
    await expect(c.save()).rejects.toThrow(EncryptedColumnError);
    await expect(c.save()).rejects.toThrow(/encrypted:json/);
  });
});

describe("cast: 'encrypted:json'", () => {
  it("round-trips a structured value through the cipher", async () => {
    const c = new Client();
    c.name = "Structured";
    c.medical = { allergies: ["penicillin"], bloodType: "O-" };
    await c.save();

    const stored = await rawColumn("clients", "medical", c.id);
    expect(stored).not.toContain("penicillin");

    const back = await Client.find(c.id);
    expect(back!.medical).toEqual({ allergies: ["penicillin"], bloodType: "O-" });
  });

  it("keeps scalar types intact", async () => {
    const c = new Client();
    c.name = "Scalars";
    c.medical = "051001";
    await c.save();

    // JSON encoding both ways, so a numeric-looking string stays a string —
    // the same property a plain `json` column has to hold.
    const back = await Client.find(c.id);
    expect(back!.medical).toBe("051001");
  });
});

describe("static encryptable", () => {
  it("encrypts every listed column", async () => {
    const p = new Patient();
    p.name = "Nomsa";
    p.idNumber = "8801015009087";
    await p.save();

    const stored = await rawColumn("patients", "id_number", p.id);
    expect(stored).not.toContain("8801015009087");
    expect((await Patient.find(p.id))!.idNumber).toBe("8801015009087");
  });

  it("encrypts a json column as JSON, not as [object Object]", async () => {
    const p = new Patient();
    p.name = "Structured";
    p.notes = { seen: "2026-08-10", by: "Dr M" };
    await p.save();

    const stored = await rawColumn("patients", "notes", p.id);
    expect(stored).not.toContain("Dr M");
    expect(stored).not.toContain("[object Object]");

    // The list form has no place to say "this one is JSON", so the declared
    // @column type decides — otherwise the object would reach the cipher via
    // String() and read back as the literal text "[object Object]".
    expect((await Patient.find(p.id))!.notes).toEqual({ seen: "2026-08-10", by: "Dr M" });
  });

  it("keeps a base class's entries when a subclass declares its own", async () => {
    const v = new VipPatient();
    v.name = "Inherited";
    v.idNumber = "7501015009087";
    await v.save();

    // VipPatient lists only "notes"; idNumber is still encrypted because the
    // lists union down the chain. Static inheritance alone would have shadowed it.
    const stored = await rawColumn("patients", "id_number", v.id);
    expect(stored).not.toContain("7501015009087");
    expect((await VipPatient.find(v.id))!.idNumber).toBe("7501015009087");
  });
});

describe("reading a value the key cannot open", () => {
  it("throws, naming the model, the column and both likely causes", async () => {
    // A row written before the cast was added — the commonest way to hit this.
    await DB.raw(`INSERT INTO clients (name, id_number) VALUES ('Legacy', '8001015009087')`);
    const [row] = (await DB.raw(`SELECT id FROM clients WHERE name = 'Legacy'`)) as Array<{
      id: number;
    }>;

    const read = Client.find(row!.id);
    await expect(read).rejects.toThrow(EncryptedColumnError);
    await expect(read).rejects.toThrow(/Client\.idNumber/);
    await expect(read).rejects.toThrow(/APP_KEY changed/);
    await expect(read).rejects.toThrow(/plaintext when the cast was added/);
  });

  it("does not hand back the ciphertext instead", async () => {
    // The tempting fallback, and the dangerous one: an unreadable value would
    // flow onward as if real — shown to a user, written into a report, or
    // re-encrypted on the next save, which loses the original for good.
    await DB.raw(`INSERT INTO clients (name, id_number) VALUES ('Garbled', 'not-ciphertext')`);
    const [row] = (await DB.raw(`SELECT id FROM clients WHERE name = 'Garbled'`)) as Array<{
      id: number;
    }>;

    await expect(Client.find(row!.id)).rejects.toThrow(EncryptedColumnError);
  });
});

describe('the @column("encrypted") shorthand', () => {
  it("resolves to a TEXT column with the encrypted cast", () => {
    @table("shorthand")
    class Shorthand extends BaseModel {
      @column("encrypted") idNumber?: string;
      @column("encrypted", { nullable: true }) passportNumber?: string;
      @column("encrypted:json") medical?: unknown;
    }

    const cols = columnsFor(Shorthand)!;
    // TEXT rather than the VARCHAR a bare `string` would give: the shorthand exists
    // largely so the storage type is not something you have to remember to get right.
    expect(cols.get("idNumber")).toMatchObject({ type: "text", cast: "encrypted" });
    expect(cols.get("medical")).toMatchObject({ type: "text", cast: "encrypted:json" });
    // The second argument carries the modifiers, so `nullable` needs no object form.
    expect(cols.get("passportNumber")).toMatchObject({
      type: "text",
      cast: "encrypted",
      nullable: true,
    });
  });

  it("encrypts for real, not just in the metadata", async () => {
    const s = new ShorthandClient();
    s.name = "Shorthand";
    s.idNumber = "8001015009087";
    await s.save();

    expect(await rawColumn("shorthand_clients", "id_number", s.id)).not.toContain("8001015009087");
    expect((await ShorthandClient.find(s.id))!.idNumber).toBe("8001015009087");
  });
});

describe("generated schema", () => {
  it("widens an encrypted column to TEXT even when declared as a string", () => {
    // The failure this prevents is not a bad error message: MySQL outside strict
    // mode truncates an over-long value rather than rejecting it, and a truncated
    // payload will never decrypt. The row is destroyed at write time, silently,
    // and nothing surfaces until someone tries to read it back.
    @table("declared_string")
    class DeclaredString extends BaseModel {
      @column({ type: "string", nullable: true, cast: "encrypted" }) idNumber?: string;
      @column({ type: "string" }) name!: string;
    }

    const schema = ModelInspector.fromClass(DeclaredString)!;
    const col = (n: string) => schema.columns.find((c) => c.name === n)!;

    expect(col("idNumber").type).toBe("text");
    expect(col("idNumber").nullable).toBe(true); // the rest of the declaration is untouched
    expect(col("name").type).toBe("string"); // ordinary columns keep what they declared
  });

  it("widens a column listed in static encryptable too", () => {
    @table("listed")
    class Listed extends BaseModel {
      static override encryptable = ["idNumber"];
      @column({ type: "string", nullable: true }) idNumber?: string;
    }

    expect(ModelInspector.fromClass(Listed)!.columns[0]!.type).toBe("text");
  });
});

describe("querying an encrypted column", () => {
  it("throws instead of silently matching nothing", async () => {
    // Without the guard the search term is encrypted under a fresh IV and compared
    // against ciphertext that used a different one — zero rows, no error, and a
    // screen that reads "no such client" for a client who is right there.
    expect(() => Client.query().where("idNumber", "8001015009087")).toThrow(EncryptedColumnError);
    expect(() => Client.query().where("idNumber", "8001015009087")).toThrow(/blind index/);
  });

  it("throws for the snake_case column name too", () => {
    expect(() => Client.query().where("id_number", "8001015009087")).toThrow(EncryptedColumnError);
  });

  it("throws for a column declared through static encryptable", () => {
    // The guard reads the same resolved cast map the read/write paths do, so the
    // list form is covered without being handled separately.
    expect(() => Patient.query().where("idNumber", "8801015009087")).toThrow(EncryptedColumnError);
  });

  it("leaves ordinary columns alone", async () => {
    const found = await Client.query().where("name", "Thandi").first();
    expect(found).not.toBeNull();
    expect(found!.idNumber).toBe("8001015009087");
  });
});
