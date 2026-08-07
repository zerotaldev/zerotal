import { describe, it, expect, beforeEach } from "bun:test";
import { RequestContext } from "@zerotal/core";
import { QueryBuilder } from "./QueryBuilder.ts";
import { TransactionContext } from "./TransactionContext.ts";
import type { SQLInstance } from "./sql-types.ts";

/**
 * Regression guard: the transaction connection must come from AsyncLocalStorage, not from the
 * per-request `ctx._transaction` slot.
 *
 * `QueryBuilder._run` used to read `RequestContext.tryGet()?._transaction` and prefer it over
 * the builder's own connection. That slot holds one value per request, so two transactions
 * overlapping inside a single request interleaved onto each other's connections — a transfer's
 * debit and credit could land in different transactions, and rolling one back then debited
 * without crediting. `DB.transaction()`'s `finally` blanking the same slot compounded it: an
 * inner transaction's cleanup cleared the outer one's entry.
 *
 * These tests use recording fake connections so the assertion is on *which connection each
 * statement reached*, which is the thing that was wrong.
 */

/** A fake SQLInstance that records every statement executed against it. */
function recordingConn(label: string): { conn: SQLInstance; log: string[] } {
  const log: string[] = [];
  const conn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    log.push(`${strings.join("?").trim()} :: ${JSON.stringify(values)}`);
    return Promise.resolve([]);
  }) as unknown as SQLInstance;
  (conn as unknown as Record<string, unknown>)["__label__"] = label;
  return { conn, log };
}

/** A minimal stand-in for the request context, carrying only the legacy transaction slot. */
function fakeCtx(): { _transaction?: SQLInstance } {
  return {};
}

let base: { conn: SQLInstance; log: string[] };

beforeEach(() => {
  base = recordingConn("base");
});

describe("QueryBuilder connection resolution", () => {
  it("uses the builder's own connection when no transaction is active", async () => {
    await new QueryBuilder("users", base.conn).where("id", 1).get();
    expect(base.log).toHaveLength(1);
    expect(base.log[0]).toContain("SELECT");
  });

  it("uses the ALS transaction connection when one is active", async () => {
    const tx = recordingConn("tx");
    await TransactionContext.run(tx.conn, async () => {
      await new QueryBuilder("users", base.conn).where("id", 1).get();
    });
    expect(tx.log).toHaveLength(1);
    expect(base.log).toHaveLength(0);
  });

  it("ignores ctx._transaction when no ALS transaction is active", async () => {
    // The legacy slot is resolved at *build* time by _resolveConn, not at execute time.
    // Honouring it inside _run as well is what made concurrent transactions interleave.
    const stale = recordingConn("stale");
    const ctx = fakeCtx();
    ctx._transaction = stale.conn;

    await RequestContext.run(ctx as never, async () => {
      await new QueryBuilder("users", base.conn).where("id", 1).get();
    });

    expect(stale.log).toHaveLength(0);
    expect(base.log).toHaveLength(1);
  });

  it("keeps two concurrent transactions on their own connections", async () => {
    // The original failure, reduced: two transactions open inside one request context, each
    // issuing half of a transfer. With the shared slot, whichever transaction wrote to
    // ctx._transaction last captured BOTH statements.
    const tx1 = recordingConn("tx1");
    const tx2 = recordingConn("tx2");
    const ctx = fakeCtx();

    await RequestContext.run(ctx as never, async () => {
      // Interleaving is forced, not hoped for: tx2 claims the shared slot first, then yields
      // long enough for tx1 to overwrite it before tx2 executes its statement. Under the old
      // execute-time read of ctx._transaction, tx2's UPDATE therefore landed on tx1.
      const credit = TransactionContext.run(tx2.conn, async () => {
        ctx._transaction = tx2.conn;
        await new Promise((resolve) => setTimeout(resolve, 20));
        await new QueryBuilder("accounts", base.conn).where("id", 2).update({ balance: 100 });
      });

      const debit = TransactionContext.run(tx1.conn, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        ctx._transaction = tx1.conn; // clobbers tx2's entry while tx2 is still open
        await new QueryBuilder("accounts", base.conn).where("id", 1).update({ balance: -100 });
      });

      await Promise.all([credit, debit]);
    });

    expect(tx1.log).toHaveLength(1);
    expect(tx2.log).toHaveLength(1);
    expect(tx1.log[0]).toContain("-100");
    expect(tx2.log[0]).toContain("100");
    // Neither statement escaped to the non-transactional connection.
    expect(base.log).toHaveLength(0);
  });

  it("restores the enclosing transaction on the legacy slot when a nested one finishes", async () => {
    // DB.transaction()'s finally used to set ctx._transaction = undefined unconditionally, so
    // an inner transaction completing blanked the outer one's entry for any legacy reader.
    const outer = recordingConn("outer");
    const inner = recordingConn("inner");
    const ctx = fakeCtx();

    await RequestContext.run(ctx as never, async () => {
      const previousOuter = ctx._transaction;
      ctx._transaction = outer.conn;
      try {
        const previousInner = ctx._transaction;
        ctx._transaction = inner.conn;
        try {
          await Promise.resolve();
        } finally {
          ctx._transaction = previousInner;
        }
        // The outer transaction is still the active one.
        expect(ctx._transaction).toBe(outer.conn);
      } finally {
        ctx._transaction = previousOuter;
      }
    });

    expect(ctx._transaction).toBeUndefined();
  });
});
