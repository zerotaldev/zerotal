/**
 * MySQL dates read back as the instant that was written, whichever Bun decoded them.
 *
 * Bun binds a `Date` as its UTC fields. Bun 1.3 decoded `DATE`, `DATETIME` and
 * `TIMESTAMP` back as *local* fields and Bun 1.4 decodes them as UTC, so on a server
 * whose `TZ` was not UTC the same row held a different `Date` depending on the
 * runtime — and on 1.3, a different one from the value written. CI's database jobs
 * run with `TZ` unset, which is UTC, where the two readings agree; that is how it
 * went unseen.
 *
 * No MySQL server here: the connection is a stub that decodes the way each Bun
 * does, so both behaviours run on every Bun. `server.smoke.test.ts` repeats the
 * round trip against a real server in CI.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  _dbDateString,
  _isUnrepresentableDate,
  _localFieldsAsUtc,
  _normalizeMysqlRows,
  _resetMysqlDateDecoding,
} from "./driverDates.ts";
import { DB, _setDbConnection } from "./DB.ts";
import { registerConnectionDialect } from "./QueryBuilder.ts";
import type { SQLInstance } from "./sql-types.ts";

const ZONE = "America/New_York";
let previousTz: string | undefined;

beforeAll(() => {
  previousTz = process.env.TZ;
  process.env.TZ = ZONE;
});

afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
  _resetMysqlDateDecoding();
  _setDbConnection(null);
});

beforeEach(() => _resetMysqlDateDecoding());

/** What MySQL stored, as `[year, monthIndex, day, hour, minute, second]`. */
type Fields = [number, number, number, number, number, number];

/** A `Date` decoded from stored fields the way the given Bun does. */
function decode(fields: Fields, as: "local" | "utc"): Date {
  return as === "local" ? new Date(...fields) : new Date(Date.UTC(...fields));
}

/**
 * A MySQL connection that answers every query with `rows`, decoding stored date
 * fields as `local` (Bun 1.3) or `utc` (Bun 1.4) — including the probe.
 */
function stubMysql(
  as: "local" | "utc",
  rows: () => Record<string, unknown>[],
): { conn: SQLInstance; probes: () => number } {
  let probes = 0;
  const fn = (strings: TemplateStringsArray): Promise<unknown[]> => {
    const sql = strings.join("?");
    const probe =
      /CAST\('(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})' AS DATETIME\) AS zt_probe/.exec(sql);
    if (probe) {
      probes++;
      const [, y, mo, d, h, mi, s] = probe.map(Number) as number[];
      return Promise.resolve([{ zt_probe: decode([y!, mo! - 1, d!, h!, mi!, s!], as) }]);
    }
    return Promise.resolve(rows());
  };
  const conn = Object.assign(fn, {
    begin: () => Promise.reject(new Error("not used")),
    end: () => Promise.resolve(),
  }) as unknown as SQLInstance;
  registerConnectionDialect(conn, "mysql");
  return { conn, probes: () => probes };
}

const STORED: Fields = [2026, 7, 20, 3, 0, 0];
const INSTANT = Date.UTC(...STORED);

describe("a zone-less stored date-time is UTC", () => {
  it("adds the Z the ORM's MySQL format leaves out", () => {
    expect(_dbDateString("2026-08-20 03:00:00")).toBe("2026-08-20T03:00:00Z");
    expect(_dbDateString("2026-08-20T03:00:00.250")).toBe("2026-08-20T03:00:00.250Z");
    expect(_dbDateString("2026-08-20 03:00")).toBe("2026-08-20T03:00Z");
  });

  it("leaves a string with its own zone, a bare date, or non-date text alone", () => {
    expect(_dbDateString("2026-08-20T03:00:00.000Z")).toBe("2026-08-20T03:00:00.000Z");
    expect(_dbDateString("2026-08-20T03:00:00+02:00")).toBe("2026-08-20T03:00:00+02:00");
    expect(_dbDateString("2026-08-20")).toBe("2026-08-20");
    expect(_dbDateString("soon")).toBe("soon");
  });

  it("reads to the instant written, which plain parsing did not under a non-UTC zone", () => {
    const written = new Date(INSTANT).toISOString().replace("T", " ").slice(0, 19);
    expect(new Date(written).getTime()).not.toBe(INSTANT);
    expect(new Date(_dbDateString(written)).getTime()).toBe(INSTANT);
  });
});

describe("_localFieldsAsUtc", () => {
  it("turns Bun 1.3's local reading into the stored UTC instant", () => {
    expect(_localFieldsAsUtc(decode(STORED, "local")).getTime()).toBe(INSTANT);
  });

  it("keeps the milliseconds and the far past", () => {
    const fields: Fields = [1901, 0, 2, 23, 59, 59];
    const local = new Date(...fields);
    local.setMilliseconds(123);
    expect(_localFieldsAsUtc(local).getTime()).toBe(Date.UTC(...fields) + 123);
  });

  it("turns Bun 1.3's zero date (the epoch) into the invalid Date 1.4 returns", () => {
    expect(Number.isNaN(_localFieldsAsUtc(new Date(0)).getTime())).toBe(true);
    expect(Number.isNaN(_localFieldsAsUtc(new Date(NaN)).getTime())).toBe(true);
  });
});

describe("_isUnrepresentableDate", () => {
  it("covers both ways a Bun reports PostgreSQL infinity", () => {
    expect(_isUnrepresentableDate(new Date(NaN))).toBe(true);
    expect(_isUnrepresentableDate(Infinity)).toBe(true);
    expect(_isUnrepresentableDate(-Infinity)).toBe(true);
    expect(_isUnrepresentableDate(new Date(0))).toBe(false);
    expect(_isUnrepresentableDate(0)).toBe(false);
    expect(_isUnrepresentableDate("infinity")).toBe(false);
  });
});

describe("_normalizeMysqlRows", () => {
  for (const as of ["local", "utc"] as const) {
    it(`gives the stored instant when the driver decodes as ${as}`, async () => {
      const { conn } = stubMysql(as, () => []);
      const rows = [{ id: 1, at: decode(STORED, as), day: decode([2026, 7, 20, 0, 0, 0], as) }];
      const out = await _normalizeMysqlRows(conn, rows);
      expect(out[0]!.at.getTime()).toBe(INSTANT);
      expect(out[0]!.day.getTime()).toBe(Date.UTC(2026, 7, 20));
    });
  }

  it("corrects a date column whose first row is null", async () => {
    const { conn } = stubMysql("local", () => []);
    const rows: Record<string, unknown>[] = [
      { id: 1, at: null, note: "a" },
      { id: 2, at: decode(STORED, "local"), note: "b" },
    ];
    await _normalizeMysqlRows(conn, rows);
    expect(rows[0]!.at).toBeNull();
    expect((rows[1]!.at as Date).getTime()).toBe(INSTANT);
  });

  it("asks the server once, not once per query", async () => {
    const { conn, probes } = stubMysql("local", () => []);
    for (let i = 0; i < 3; i++) await _normalizeMysqlRows(conn, [{ at: decode(STORED, "local") }]);
    expect(probes()).toBe(1);
  });

  it("does not ask at all for rows with no date in them", async () => {
    const { conn, probes } = stubMysql("local", () => []);
    await _normalizeMysqlRows(conn, [{ id: 1, name: "x" }]);
    await _normalizeMysqlRows(conn, []);
    expect(probes()).toBe(0);
  });

  it("asks again when the process zone changes", async () => {
    const { conn, probes } = stubMysql("local", () => []);
    await _normalizeMysqlRows(conn, [{ at: decode(STORED, "local") }]);
    process.env.TZ = "Asia/Kolkata";
    try {
      const out = await _normalizeMysqlRows(conn, [{ at: decode(STORED, "local") }]);
      expect(out[0]!.at.getTime()).toBe(INSTANT);
      expect(probes()).toBe(2);
    } finally {
      process.env.TZ = ZONE;
    }
  });

  it("needs no probe in a zone with no offset, where both readings agree", async () => {
    process.env.TZ = "UTC";
    try {
      const { conn, probes } = stubMysql("local", () => []);
      const out = await _normalizeMysqlRows(conn, [{ at: decode(STORED, "local") }]);
      expect(out[0]!.at.getTime()).toBe(INSTANT);
      expect(probes()).toBe(0);
    } finally {
      process.env.TZ = ZONE;
    }
  });

  it("keeps the driver's result array, with its count", async () => {
    const { conn } = stubMysql("local", () => []);
    const rows = Object.assign([{ at: decode(STORED, "local") }], { count: 1 });
    const out = await _normalizeMysqlRows(conn, rows);
    expect(out).toBe(rows);
    expect((out as typeof rows).count).toBe(1);
  });

  it("returns the rows as the driver gave them when the probe fails", async () => {
    const conn = Object.assign(() => Promise.reject(new Error("gone")), {
      begin: () => Promise.reject(new Error("not used")),
      end: () => Promise.resolve(),
    }) as unknown as SQLInstance;
    const at = decode(STORED, "local");
    const out = await _normalizeMysqlRows(conn, [{ at }]);
    expect(out[0]!.at).toBe(at);
  });
});

describe("rows the ORM returns from MySQL", () => {
  for (const as of ["local", "utc"] as const) {
    it(`agree on every Bun: query builder, decoding as ${as}`, async () => {
      const { conn } = stubMysql(as, () => [{ id: 1, at: decode(STORED, as) }]);
      _setDbConnection(conn);
      const row = await DB.table("events").first<{ at: Date }>();
      expect(row!.at.getTime()).toBe(INSTANT);
    });

    it(`agree on every Bun: DB.raw, decoding as ${as}`, async () => {
      const { conn } = stubMysql(as, () => [{ id: 1, at: decode(STORED, as) }]);
      _setDbConnection(conn);
      const [viaString] = await DB.raw<{ at: Date }>("SELECT at FROM events WHERE id = ?", [1]);
      expect(viaString!.at.getTime()).toBe(INSTANT);
      const [viaTag] = await DB.raw<{ at: Date }>`SELECT at FROM events WHERE id = ${1}`;
      expect(viaTag!.at.getTime()).toBe(INSTANT);
    });
  }
});
