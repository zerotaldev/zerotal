import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, spyOn } from "bun:test";
import { SQL } from "bun";
import { HttpContext, RequestContext } from "@zerotal/core";
import {
  trackQuery,
  preventNPlusOne,
  allowNPlusOne,
  NPlusOneError,
  _resetNPlusOne,
} from "./NPlusOneDetector.ts";
import { QueryBuilder } from "./QueryBuilder.ts";

// ── Shared spy ────────────────────────────────────────────────────────────────
// bun's spyOn returns the same underlying Mock when called on the same property
// multiple times — calls accumulate across tests unless we reuse one spy and
// clear it in beforeEach.

let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

beforeAll(() => {
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  warnSpy.mockRestore();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): HttpContext {
  return HttpContext.fake("http://localhost/");
}

const FP_COMMENTS = "select * from comments where post_id = \x00";
const FP_USERS = "select * from users where id = \x00";

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  warnSpy.mockClear();
  _resetNPlusOne();
  preventNPlusOne({ threshold: 5, mode: "warn" });
});

afterEach(() => {
  _resetNPlusOne();
});

// ── NPlusOneError ─────────────────────────────────────────────────────────────

describe("NPlusOneError", () => {
  it("renders \\x00 as ? in the message", () => {
    const err = new NPlusOneError("select * from comments where post_id = \x00", 7);
    expect(err.message).toContain("select * from comments where post_id = ?");
    expect(err.message).toContain("7 times");
    expect(err.name).toBe("NPlusOneError");
  });

  it("exposes fingerprint and count", () => {
    const err = new NPlusOneError(FP_COMMENTS, 5);
    expect(err.fingerprint).toBe(FP_COMMENTS);
    expect(err.count).toBe(5);
  });

  it("message includes the fix hint and allowNPlusOne examples", () => {
    const err = new NPlusOneError(FP_COMMENTS, 5);
    expect(err.message).toContain(".with(");
    expect(err.message).toContain("DB.allowNPlusOne");
  });
});

// ── warn mode ─────────────────────────────────────────────────────────────────

describe("trackQuery — warn mode", () => {
  it("does not warn below the threshold", () => {
    const ctx = makeCtx();
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 4; i++) trackQuery(ctx, FP_COMMENTS);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns exactly once when threshold is reached", () => {
    const ctx = makeCtx();
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 7; i++) trackQuery(ctx, FP_COMMENTS);
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain("NPlusOneError");
    expect(msg).toContain("5 times");
  });

  it("fires independently for different query shapes", () => {
    const ctx = makeCtx();
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 5; i++) trackQuery(ctx, FP_COMMENTS);
      for (let i = 0; i < 5; i++) trackQuery(ctx, FP_USERS);
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("counts are isolated per request context", () => {
    const ctx1 = makeCtx();
    const ctx2 = makeCtx();
    RequestContext.run(ctx1, () => {
      for (let i = 0; i < 5; i++) trackQuery(ctx1, FP_COMMENTS);
    });
    RequestContext.run(ctx2, () => {
      for (let i = 0; i < 4; i++) trackQuery(ctx2, FP_COMMENTS);
    });
    // ctx1 triggers at threshold; ctx2 stays at 4 (below 5)
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ── throw mode ────────────────────────────────────────────────────────────────

describe("trackQuery — throw mode", () => {
  it("throws NPlusOneError at threshold", () => {
    preventNPlusOne({ mode: "throw" });
    const ctx = makeCtx();
    expect(() =>
      RequestContext.run(ctx, () => {
        for (let i = 0; i < 5; i++) trackQuery(ctx, FP_COMMENTS);
      }),
    ).toThrow(NPlusOneError);
  });

  it("thrown error carries the correct count", () => {
    preventNPlusOne({ mode: "throw" });
    const ctx = makeCtx();
    let caught: NPlusOneError | undefined;
    try {
      RequestContext.run(ctx, () => {
        for (let i = 0; i < 5; i++) trackQuery(ctx, FP_COMMENTS);
      });
    } catch (e) {
      caught = e as NPlusOneError;
    }
    expect(caught).toBeInstanceOf(NPlusOneError);
    expect(caught!.count).toBe(5);
  });
});

// ── custom threshold ──────────────────────────────────────────────────────────

describe("preventNPlusOne() — threshold", () => {
  it("respects a custom threshold", () => {
    preventNPlusOne({ threshold: 3, mode: "throw" });
    const ctx = makeCtx();
    expect(() =>
      RequestContext.run(ctx, () => {
        for (let i = 0; i < 3; i++) trackQuery(ctx, FP_COMMENTS);
      }),
    ).toThrow(NPlusOneError);
  });

  it("does not trigger below the custom threshold", () => {
    preventNPlusOne({ threshold: 10 });
    const ctx = makeCtx();
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 9; i++) trackQuery(ctx, FP_COMMENTS);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── allowNPlusOne() ───────────────────────────────────────────────────────────

describe("allowNPlusOne()", () => {
  it("permanent suppression silences warnings for matching queries", () => {
    allowNPlusOne("comments", undefined, null);
    const ctx = makeCtx();
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 10; i++) trackQuery(ctx, FP_COMMENTS);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("permanent suppression does not affect non-matching queries", () => {
    allowNPlusOne("comments", undefined, null);
    const ctx = makeCtx();
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 5; i++) trackQuery(ctx, FP_USERS);
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("once-per-request suppression silences warnings for that context", () => {
    const ctx = makeCtx();
    allowNPlusOne("comments", { once: true }, ctx);
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 10; i++) trackQuery(ctx, FP_COMMENTS);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("once-per-request suppression does not carry over to a second context", () => {
    const ctx1 = makeCtx();
    const ctx2 = makeCtx();
    allowNPlusOne("comments", { once: true }, ctx1);
    RequestContext.run(ctx1, () => {
      for (let i = 0; i < 10; i++) trackQuery(ctx1, FP_COMMENTS);
    });
    RequestContext.run(ctx2, () => {
      for (let i = 0; i < 5; i++) trackQuery(ctx2, FP_COMMENTS);
    });
    // ctx1 suppressed, ctx2 not — warns once for ctx2
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ── non-SELECT queries are ignored ────────────────────────────────────────────

describe("non-SELECT queries", () => {
  it("does not track INSERT queries", () => {
    const ctx = makeCtx();
    const fp = "insert into comments (body) values (\x00)";
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 10; i++) trackQuery(ctx, fp);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not track UPDATE queries", () => {
    const ctx = makeCtx();
    const fp = "update comments set body = \x00 where id = \x00";
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 10; i++) trackQuery(ctx, fp);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not track DELETE queries", () => {
    const ctx = makeCtx();
    const fp = "delete from comments where id = \x00";
    RequestContext.run(ctx, () => {
      for (let i = 0; i < 10; i++) trackQuery(ctx, fp);
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ── null / undefined context ──────────────────────────────────────────────────

describe("null context (outside request)", () => {
  it("does not throw when ctx is null", () => {
    expect(() => trackQuery(null, FP_COMMENTS)).not.toThrow();
  });

  it("does not throw when ctx is undefined", () => {
    expect(() => trackQuery(undefined, FP_COMMENTS)).not.toThrow();
  });
});

// ── integration: real QueryBuilder hits ──────────────────────────────────────

describe("QueryBuilder integration", () => {
  it("warns when the same SELECT shape fires 5 times in one request", async () => {
    const db: SQLInstance = new SQL(":memory:");
    await db`CREATE TABLE n1_comments (id INTEGER PRIMARY KEY, post_id INTEGER, body TEXT)`;
    for (let i = 1; i <= 5; i++) {
      await db`INSERT INTO n1_comments (post_id, body) VALUES (${i}, ${"x"})`;
    }

    const ctx = makeCtx();
    await RequestContext.run(ctx, async () => {
      for (let i = 1; i <= 5; i++) {
        await new QueryBuilder("n1_comments", db).where("post_id", i).get();
      }
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0] as string).toContain("n1_comments");

    await db.end();
  });
});
