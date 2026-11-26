import { describe, expect, it } from "bun:test";
import {
  _describeMigrationNumberClashes,
  _migrationNumberClashes,
  _migrationOrdinal,
  _partitionMigrationNumberClashes,
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
    expect(_migrationOrdinal("2024_01_01_000000_create_users")?.key).toBe("20240101000000");
    expect(_migrationOrdinal("20240101000000_create_users")?.key).toBe("20240101000000");
  });

  it("has none for a date with no time: files written on one day share it as a matter of course", () => {
    // Read as a number, each of these was the year, and every migration of a year clashed.
    expect(_migrationOrdinal("2024_01_15_create_users")).toBeUndefined();
    expect(_migrationOrdinal("2024-01-15-create_users")).toBeUndefined();
    expect(_migrationOrdinal("20240115_create_users")).toBeUndefined();
  });

  it("has none when a letter follows the number, which is how an app keeps a run clash in place", () => {
    expect(_migrationOrdinal("0042b_add_refunds")).toBeUndefined();
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

  it("does not treat migrations dated the same day as clashing", () => {
    expect(
      _migrationNumberClashes([
        "2026_11_01_create_x.ts",
        "2026_11_20_add_y.ts",
        "20261120_add_z.ts",
        "20261120_add_w.ts",
      ]),
    ).toEqual([]);
  });

  it("still finds two migrations stamped with the same second", () => {
    expect(_migrationNumberClashes(["2024_01_01_000000_a.ts", "20240101000000_b.ts"])).toHaveLength(
      1,
    );
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

describe("_partitionMigrationNumberClashes", () => {
  const migrations = [
    { file: "0042_add_invoices", name: "0042_add_invoices" },
    { file: "0042_add_refunds", name: "0042_add_refunds" },
  ];
  const clash = { number: "0042", files: ["0042_add_invoices", "0042_add_refunds"] };

  it("calls a clash divergent when this database ran one side and not the other", () => {
    const parts = _partitionMigrationNumberClashes(
      [clash],
      migrations,
      new Set(["0042_add_refunds"]),
    );
    expect(parts).toEqual({ divergent: [clash], fresh: [] });
  });

  it("calls it fresh on a database that has run neither, which runs them in name order", () => {
    // A new environment of an app whose clash shipped long ago: refusing here would
    // stop every fresh database for something no fresh database gets wrong.
    const parts = _partitionMigrationNumberClashes(
      [clash],
      migrations,
      new Set(["0042_add_invoices", "0042_add_refunds"]),
    );
    expect(parts).toEqual({ divergent: [], fresh: [clash] });
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

  it("keeps an already-run migration in its place rather than moving it after later ones", () => {
    const text = _describeMigrationNumberClashes(
      [{ number: "0042", files: ["0042_add_invoices", "0042_add_refunds"] }],
      "0043",
    );
    // `0042b_` sorts after `0042_add_invoices` and before any `0043_`.
    expect(text).toContain("database/migrations/0042b_add_refunds.ts");
    expect(["0042_add_invoices", "0042b_add_refunds", "0043_alter_refunds"].sort()).toEqual([
      "0042_add_invoices",
      "0042b_add_refunds",
      "0043_alter_refunds",
    ]);
  });
});
