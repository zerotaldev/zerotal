/**
 * Regression test for the loop-variable handler bug: a client handler that closes
 * over a `.map()` loop variable — `onClick={() => this.setRange(r)}` — must ship the
 * captured value (`$flow.setRange('1h')`), not a broken reference to the server-only
 * `r` (`() => $flow.setRange(r)`).
 */
import { describe, it, expect } from "bun:test";
import { _renderFlowPage, jsx } from "./jsx-runtime.ts";
import { expose } from "./decorators.ts";

const render = (p: object, fn: () => unknown): Promise<string> =>
  _renderFlowPage(p as never, () => Promise.resolve(fn()));

describe("client handler — loop-variable capture", () => {
  it("inlines a closed-over loop variable into each server-action call", async () => {
    class P {
      @expose range = "live";
      setRange(_r: string): void {}
      render(): unknown {
        const RANGES = ["live", "1h", "24h", "7d"];
        return jsx("div", {
          children: RANGES.map((r) =>
            jsx("button", { key: r, onClick: () => this.setRange(r), children: r }),
          ),
        });
      }
    }
    const p = new P();
    const html = await render(p, () => p.render());

    expect(html).toContain(`flow:click="$flow.setRange('live')"`);
    expect(html).toContain(`flow:click="$flow.setRange('1h')"`);
    expect(html).toContain(`flow:click="$flow.setRange('24h')"`);
    expect(html).toContain(`flow:click="$flow.setRange('7d')"`);
    // No broken bare identifier, and the prototype method is left intact.
    expect(html).not.toContain("setRange(r)");
    expect(typeof p.setRange).toBe("function");
  });

  it("captures a numeric loop argument (e.g. row id)", async () => {
    class P {
      openRow(_id: number): void {}
      render(): unknown {
        return jsx("div", {
          children: [10, 20].map((id) =>
            jsx("button", { key: id, onClick: () => this.openRow(id), children: "open" }),
          ),
        });
      }
    }
    const p = new P();
    const html = await render(p, () => p.render());
    expect(html).toContain(`flow:click="$flow.openRow(10)"`);
    expect(html).toContain(`flow:click="$flow.openRow(20)"`);
  });

  it("does NOT execute the real action while capturing", async () => {
    let calls = 0;
    class P {
      bump(_n: number): void {
        calls++;
      }
      render(): unknown {
        return jsx("button", { onClick: () => this.bump(5), children: "x" });
      }
    }
    const p = new P();
    const html = await render(p, () => p.render());
    expect(html).toContain(`flow:click="$flow.bump(5)"`);
    expect(calls).toBe(0); // captured via a recorder, never actually run
  });

  it("leaves client-state and event-using handlers verbatim", async () => {
    class P {
      @expose open = false;
      save(_e: unknown): void {}
      render(): unknown {
        return jsx("div", {
          children: [
            jsx("button", { key: "a", onClick: () => (this.open = false), children: "close" }),
            jsx("button", { key: "b", onClick: (e: unknown) => this.save(e), children: "save" }),
          ],
        });
      }
    }
    const p = new P();
    const html = await render(p, () => p.render());
    expect(html).toContain("$flow.open = false"); // assignment → expression, unchanged
    expect(html).toContain("$flow.save(e)"); // needs the event arg → stays an arrow
  });
});
