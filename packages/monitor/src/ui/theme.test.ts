import { describe, it, expect } from "bun:test";
import { MonitorLayout } from "./MonitorLayout.tsx";
import { flowTailwindCss, flowTokensCss } from "@zerotal/flow-ui";

/** flow-ui's `:root` and `.dark` palettes, without the base rules that follow them. */
const PALETTE = flowTokensCss().slice(0, flowTokensCss().indexOf("\n* {"));

describe("MonitorLayout theme", () => {
  it("takes its palette from flow-ui rather than defining its own", () => {
    // The panel is themed by the component kit it renders with. If this ever
    // stops being true the two drift apart again, which is what the shared
    // theme exists to prevent.
    expect(PALETTE).toContain(".dark {");
    expect(MonitorLayout.head).toContain(PALETTE);
    expect(MonitorLayout.head).toContain(flowTailwindCss());
  });

  it("overrides only the brand colour, layered after the shared tokens", () => {
    const head = MonitorLayout.head;
    const shared = head.indexOf(PALETTE);
    const override = head.indexOf("--primary: 21 90% 48%");

    expect(override).toBeGreaterThan(shared);
  });

  it("ships the no-flash script so a dark-mode reload doesn't flash white", () => {
    expect(MonitorLayout.head).toContain('classList.toggle("dark"');
  });

  it("carries the semantic tokens the panel's tones resolve against", () => {
    const head = MonitorLayout.head;
    for (const token of ["--success", "--warning", "--destructive", "--chart-3"]) {
      expect(head).toContain(token);
    }
  });
});
