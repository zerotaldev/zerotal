import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { Seeder } from "./Seeder.ts";
import { _setDbConnection } from "../db/DB.ts";

// Seeder.call() wraps in DB.transaction(), so a working connection is needed.
let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setDbConnection(db);
});

afterAll(async () => {
  _setDbConnection(null);
  await db.end();
});

describe("Seeder", () => {
  it("subclasses must implement run()", async () => {
    class TestSeeder extends Seeder {
      public ran = false;
      async run(): Promise<void> {
        this.ran = true;
      }
    }
    const s = new TestSeeder();
    await s.run();
    expect(s.ran).toBe(true);
  });

  it("call() runs multiple seeders in sequence", async () => {
    const order: number[] = [];

    class SeederA extends Seeder {
      async run() {
        order.push(1);
      }
    }
    class SeederB extends Seeder {
      async run() {
        order.push(2);
      }
    }
    class SeederC extends Seeder {
      async run() {
        order.push(3);
      }
    }

    class RootSeeder extends Seeder {
      async run() {
        await this.call([SeederA, SeederB, SeederC]);
      }
    }

    await new RootSeeder().run();
    expect(order).toEqual([1, 2, 3]);
  });

  it("call() stops if a seeder throws", async () => {
    const ran: string[] = [];

    class GoodSeeder extends Seeder {
      async run() {
        ran.push("good");
      }
    }
    class BadSeeder extends Seeder {
      async run() {
        throw new Error("seeder failed");
      }
    }
    class AfterBad extends Seeder {
      async run() {
        ran.push("after");
      }
    }

    class Root extends Seeder {
      async run() {
        await this.call([GoodSeeder, BadSeeder, AfterBad]);
      }
    }

    let threw = false;
    try {
      await new Root().run();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(ran).toContain("good");
    expect(ran).not.toContain("after");
  });

  it("call() with an empty array does nothing", async () => {
    class EmptyRoot extends Seeder {
      async run() {
        await this.call([]);
      }
    }
    await expect(new EmptyRoot().run()).resolves.toBeUndefined();
  });

  it("call() can be nested — inner call reuses the outer transaction", async () => {
    const log: string[] = [];

    class LeafA extends Seeder {
      async run() {
        log.push("leaf-a");
      }
    }
    class LeafB extends Seeder {
      async run() {
        log.push("leaf-b");
      }
    }
    class MidSeeder extends Seeder {
      async run() {
        log.push("mid-start");
        await this.call([LeafA, LeafB]);
        log.push("mid-end");
      }
    }
    class TopSeeder extends Seeder {
      async run() {
        await this.call([MidSeeder]);
      }
    }

    await new TopSeeder().run();
    expect(log).toEqual(["mid-start", "leaf-a", "leaf-b", "mid-end"]);
  });

  it("call() wraps in a single transaction — all roll back on error", async () => {
    const ran: number[] = [];

    class S1 extends Seeder {
      async run() {
        ran.push(1);
      }
    }
    class S2 extends Seeder {
      async run() {
        throw new Error("boom");
      }
    }
    class S3 extends Seeder {
      async run() {
        ran.push(3);
      }
    }

    class Root extends Seeder {
      async run() {
        await this.call([S1, S2, S3]);
      }
    }

    let threw = false;
    try {
      await new Root().run();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(ran).toContain(1);
    expect(ran).not.toContain(3);
  });
});
