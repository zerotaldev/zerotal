import { describe, expect, it } from "bun:test";
import {
  _describeMigrationNumberClashes,
  _migrationNumberClashes,
  _migrationOrdinal,
  _unappliedMigrationNumberClashes,
} from "./migrationNumbers.ts";

describe("_migrationOrdinal", () => {
  it("reads a sequence number by value, so 042 and 0042 are the same number", () => {
    expect(_migrationOrdinal("0042_add_x")?.key).toBe("42");
    expect(_migrationOrdinal("042_add_x")?.key).toBe("42");
    expect(_migrationOrdinal("42-add-x")?.key).toBe("42");
    expect(_migrationOrdinal("0000_init")?.key).toBe("0");
  });

  it("reads a dated name as its whole timestamp, not its year", () => {
    expect(_migrationOrdinal("2024_01_01_000000_create_users")?.key).toBe("2024_01_01_000000");
  });

  it("has none for a name that does not start with a number", () => {
    expect(_migrationOrdinal("create_users")).toBeUndefined();
    expect(_migrationOrdinal("2fa_setup")).toBeUndefined();
  });
});

describe("_migrationNumberClashes", () => {
  it("finds two different migrations under one number", () => {
    const clashes = _migrationNumberClashes([
      "database/migrations/0041_create_users.ts",
      "database/migrations/0042_add_invoices.ts",
      "database/migrations/0042_add_refunds.ts",
    ]);
    expect(clashes).toEqual([{ number: "0042", files: ["0042_add_invoices", "0042_add_refunds"] }]);
  });

  it("counts a number written at two widths as one number", () => {
    const clashes = _migrationNumberClashes(["001_a.ts", "0001_b.ts"]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]!.files).toEqual(["0001_b", "001_a"]);
  });

  it("does not treat migrations dated in the same year as clashing", () => {
    expect(
      _migrationNumberClashes([
        "2024_01_01_000000_create_users.ts",
        "2024_03_09_120000_create_posts.ts",
      ]),
    ).toEqual([]);
  });

  it("accepts Windows separators", () => {
    expect(_migrationNumberClashes(["database\\migrations\\003_a.ts", "003_b.ts"])).toHaveLength(1);
  });

  it("is empty when every number is unique", () => {
    expect(_migrationNumberClashes(["001_a.ts", "002_b.ts", "README.ts"])).toEqual([]);
  });
});

describe("_unappliedMigrationNumberClashes", () => {
  const migrations = [
    { file: "0042_add_invoices", name: "0042_add_invoices" },
    { file: "0042_add_refunds", name: "0042_add_refunds" },
  ];

  it("keeps a clash with a member still to run", () => {
    expect(
      _unappliedMigrationNumberClashes(migrations, new Set(["0042_add_refunds"])),
    ).toHaveLength(1);
  });

  it("drops a clash whose members have all run: that is history, not a decision", () => {
    expect(_unappliedMigrationNumberClashes(migrations, new Set())).toEqual([]);
  });

  it("reads the file, so a renumbered migration that pins its identity is out of the way", () => {
    const moved = [
      { file: "0042_add_invoices", name: "0042_add_invoices" },
      // Renamed to 0043 on disk, recorded identity kept with `static id`.
      { file: "0043_add_refunds", name: "0042_add_refunds" },
    ];
    expect(_unappliedMigrationNumberClashes(moved, new Set(["0042_add_refunds"]))).toEqual([]);
  });

  it("falls back to the identity for a record with no file", () => {
    expect(
      _unappliedMigrationNumberClashes([{ name: "007_a" }, { name: "007_b" }], new Set(["007_b"])),
    ).toHaveLength(1);
  });
});

describe("_describeMigrationNumberClashes", () => {
  it("names the files, the next free number and the identity pin", () => {
    const text = _describeMigrationNumberClashes(
      [{ number: "0042", files: ["0042_add_invoices", "0042_add_refunds"] }],
      "0043",
    );
    expect(text).toContain("0042: 0042_add_invoices.ts, 0042_add_refunds.ts");
    expect(text).toContain("database/migrations/0043_add_refunds.ts");
    expect(text).toContain('static override id = "0042_add_refunds";');
  });
});
