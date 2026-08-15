/**
 * TEMPORARY DIAGNOSTIC — delete once the Linux-only `child-keys` failure is fixed.
 *
 * `_drainFields` learns a class's own decorated field names by constructing it and
 * reading `Object.keys`. Bun's standard-decorator miscompilation cross-wires field
 * initializers across the classes defined in one file, so that probe may answer with
 * another class's fields — or with none. This file mirrors `child-keys.test.ts`'s
 * exact shape (a decorated class, a second decorated class, then a fieldless one) and
 * prints what the probe actually sees, so CI can say what this machine cannot.
 */
import { describe, it, expect } from "bun:test";
import { Component } from "./Component.ts";
import type { HtmlNode } from "./jsx-runtime.ts";
import { expose, reactive } from "./decorators.ts";
import { getReactiveProps, getExposedProps } from "./decorators.ts";

class DiagRow extends Component {
  @expose settingKey = "";
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

class DiagCounter extends Component {
  @reactive count = 0;
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

class DiagNotice extends Component {
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

describe("drain diagnostic", () => {
  it("reports what the probe sees", () => {
    // Constructed BEFORE any drain, in the same order child-keys.test.ts reaches them.
    const rowKeys = Object.keys(new DiagRow());
    const counterKeys = Object.keys(new DiagCounter());
    const noticeKeys = Object.keys(new DiagNotice());

    console.log(`DIAG probe DiagRow     own keys = ${JSON.stringify(rowKeys)}`);
    console.log(`DIAG probe DiagCounter own keys = ${JSON.stringify(counterKeys)}`);
    console.log(`DIAG probe DiagNotice  own keys = ${JSON.stringify(noticeKeys)}`);

    const reactiveOnCounter = [...getReactiveProps(DiagCounter.prototype)];
    const reactiveOnRow = [...getReactiveProps(DiagRow.prototype)];
    const exposedOnRow = [...getExposedProps(new DiagRow())];
    const exposedOnCounter = [...getExposedProps(new DiagCounter())];

    console.log(`DIAG reactive(DiagCounter) = ${JSON.stringify(reactiveOnCounter)}`);
    console.log(`DIAG reactive(DiagRow)     = ${JSON.stringify(reactiveOnRow)}`);
    console.log(`DIAG exposed(DiagRow)      = ${JSON.stringify(exposedOnRow)}`);
    console.log(`DIAG exposed(DiagCounter)  = ${JSON.stringify(exposedOnCounter)}`);

    // Not an assertion about the bug — just something that always passes, so the
    // diagnostic never turns a red suite into a differently-red suite.
    expect(true).toBe(true);
  });
});
