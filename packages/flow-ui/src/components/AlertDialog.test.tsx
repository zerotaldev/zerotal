/** @jsxImportSource @zerotal/flow */
import { describe, it, expect } from "bun:test";
import { AlertDialog } from "./AlertDialog.tsx";
import { Dialog } from "./Dialog.tsx";

/**
 * `<AlertDialog>` promises that only its two buttons close it. It is built on `<Dialog>` with
 * `closable={false}`, which removed the × but left the backdrop click and Escape wired, and
 * overwrote the `alertdialog` role with `dialog`.
 */
describe("<AlertDialog>", () => {
  const html = (
    AlertDialog({ show: true, name: "confirming", title: "Delete?" }) as { html: string }
  ).html;

  it("cannot be closed by the backdrop", () => {
    const backdrop = /<div class="absolute inset-0 bg-black\/50"[^>]*>/.exec(html)?.[0] ?? "";
    expect(backdrop).not.toBe("");
    expect(backdrop).not.toContain("flow:click");
  });

  it("cannot be closed with Escape", () => {
    expect(html).not.toContain("data-flow-modal");
  });

  it("keeps its alertdialog role", () => {
    expect(html).toContain('role="alertdialog"');
    expect(html).not.toContain('role="dialog"');
  });
});

describe("<Dialog>", () => {
  it("still closes on the backdrop and Escape by default", () => {
    const html = (Dialog({ show: true, name: "open", title: "Hi" }) as { html: string }).html;
    expect(html).toContain("data-flow-modal");
    expect(/<div class="absolute inset-0 bg-black\/50"[^>]*>/.exec(html)?.[0]).toContain(
      "flow:click",
    );
    expect(html).toContain('role="dialog"');
  });
});
