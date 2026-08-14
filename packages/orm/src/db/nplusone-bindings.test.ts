/**
 * The N+1 detector should say *which* problem it found.
 *
 * It grouped purely by SQL text, so a legitimate loop over six months —
 * identical SQL, a different `period` binding each time — reported as an N+1 and
 * told you to eager-load a relation that does not exist. The reverse case, the
 * same read repeated with the same arguments, got the same advice and is not
 * fixed by eager loading either: it is fixed by asking once.
 *
 * Same SQL + same args and same SQL + different args are different bugs with
 * different fixes, and the bindings are what tell them apart.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { DB } from "./DB.ts";
import { _setDbConnection } from "../index.ts";
import { NPlusOneError, preventNPlusOne, _resetNPlusOne } from "./NPlusOneDetector.ts";
import { RequestContext } from "@zerotal/core";
import { HttpContext } from "@zerotal/core";

beforeEach(async () => {
  _setDbConnection(new SQL(":memory:") as never);
  await DB.raw(`CREATE TABLE spend (id INTEGER PRIMARY KEY AUTOINCREMENT, period TEXT, total INT)`);
  for (const period of ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]) {
    await DB.table("spend").insert({ period, total: 10 });
  }
  preventNPlusOne({ threshold: 3, mode: "throw" });
});

afterEach(() => _resetNPlusOne());

/** Run inside a request boundary — the detector counts per HttpContext. */
async function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = HttpContext.fake("http://localhost/report");
  return RequestContext.run(ctx, fn);
}

describe("N+1 detection with bindings", () => {
  it("calls a per-key loop what it is, and points at eager loading", async () => {
    const run = inRequest(async () => {
      for (const period of ["2026-01", "2026-02", "2026-03", "2026-04"]) {
        await DB.table("spend").where("period", period).get();
      }
    });

    await expect(run).rejects.toThrow(NPlusOneError);
    await expect(run).rejects.toThrow(/different argument sets/);
    await expect(run).rejects.toThrow(/whereIn/);
  });

  it("counts the distinct argument sets it saw", async () => {
    try {
      await inRequest(async () => {
        for (const period of ["a", "b", "c", "d"]) {
          await DB.table("spend").where("period", period).get();
        }
      });
      throw new Error("expected an N+1 error");
    } catch (error) {
      expect(error).toBeInstanceOf(NPlusOneError);
      expect((error as NPlusOneError).distinctArgs).toBe(3); // fires at the threshold
    }
  });

  it("recognises the same read repeated, and does not suggest eager loading", async () => {
    const run = inRequest(async () => {
      for (let i = 0; i < 4; i++) {
        await DB.table("spend").where("period", "2026-01").get();
      }
    });

    await expect(run).rejects.toThrow(NPlusOneError);
    await expect(run).rejects.toThrow(/same arguments every time/);
    await expect(run).rejects.toThrow(/RequestContext\.remember/);
    // The advice that would have wasted the reader's time.
    await expect(run).rejects.not.toThrow(/eager-load using/);
  });

  it("reports distinctArgs of 1 for the repeated-read case", async () => {
    try {
      await inRequest(async () => {
        for (let i = 0; i < 4; i++) await DB.table("spend").where("period", "same").get();
      });
      throw new Error("expected an N+1 error");
    } catch (error) {
      expect((error as NPlusOneError).distinctArgs).toBe(1);
    }
  });

  it("still leaves a query under the threshold alone", async () => {
    await inRequest(async () => {
      await DB.table("spend").where("period", "2026-01").get();
      await DB.table("spend").where("period", "2026-02").get();
    });
  });
});
