/** @jsxImportSource @zerotal/flow */
// The promise `<Icon>` makes is that a name renders with nothing installed, so the
// assertions here are mostly about the bundled set actually being present and
// correct — a mocked icon set would test the mock.
import { describe, it, expect, afterEach } from "bun:test";
import { Icon } from "./Icon.tsx";
import { registerIcons, resolveIcon, _resetIcons } from "../icons/loader.ts";
import { isIconName } from "../icons/registry.ts";
import type { IconName } from "../icons/registry.ts";

afterEach(() => _resetIcons());

describe("the bundled set", () => {
  it("resolves an icon with nothing installed", () => {
    const icon = resolveIcon("inbox");
    expect(icon).not.toBeNull();
    expect(icon!.body).toContain("<path");
    expect(icon!.width).toBe(24);
    expect(icon!.height).toBe(24);
  });

  it("resolves an alias to the icon it points at", () => {
    // Lucide renamed `home` to `house` and kept the old name as an alias. Both
    // are in the union, so both have to render.
    const alias = resolveIcon("home");
    const target = resolveIcon("house");
    expect(alias).not.toBeNull();
    expect(alias!.body).toBe(target!.body);
  });

  it("returns null for a name nothing answers to", () => {
    expect(resolveIcon("definitely-not-an-icon")).toBeNull();
  });
});

describe("<Icon>", () => {
  it("renders inline SVG with a viewBox from the set", () => {
    const { html } = Icon({ name: "inbox" });
    expect(html).toContain("<svg");
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain("</svg>");
  });

  it("inserts the body as markup rather than escaping it", () => {
    const { html } = Icon({ name: "inbox" });
    expect(html).toContain("<path");
    expect(html).not.toContain("&lt;path");
  });

  it("sets no fill on the wrapper, so a stroke set stays an outline", () => {
    // Lucide bodies carry `fill="none" stroke="currentColor"`. A fill on the
    // <svg> would paint every outline solid — silently, and on all 1,843 of them.
    const { html } = Icon({ name: "inbox" });
    const openTag = html.slice(0, html.indexOf(">"));
    expect(openTag).not.toContain("fill=");
  });

  it("sizes in em so it inherits the surrounding text", () => {
    const { html } = Icon({ name: "inbox" });
    expect(html).toContain('width="1em"');
    expect(html).toContain('height="1em"');
  });

  it("merges a class rather than replacing the defaults", () => {
    const { html } = Icon({ name: "inbox", class: "size-5 text-red-600" });
    expect(html).toContain("size-5");
    expect(html).toContain("text-red-600");
    expect(html).toContain("shrink-0");
  });

  it("is hidden from assistive technology when it is decoration", () => {
    const { html } = Icon({ name: "inbox" });
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });

  it("is announced when it carries the meaning", () => {
    const { html } = Icon({ name: "trash-2", label: "Delete order" });
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Delete order"');
    expect(html).not.toContain("aria-hidden");
  });

  it("renders nothing for an unresolvable name instead of throwing", () => {
    // Cast: the union exists to stop this at compile time. The runtime still has
    // to cope, because a name can arrive from a database column.
    const { html } = Icon({ name: "not-a-real-icon" as never });
    expect(html).toBe("");
  });
});

describe("the hand-drawn icons", () => {
  const DRAWN = ["passkey", "two-factor", "otp", "magic-link"] as const;

  // A plain loop rather than `it.each`, which widens the tuple element to
  // `unknown` — every callback would then need a cast to state what the array
  // beside it already says.
  for (const name of DRAWN) {
    describe(name, () => {
      it("resolves from the bundled set", () => {
        expect(resolveIcon(name)).not.toBeNull();
      });

      it("is drawn on the same 24×24 grid as the rest", () => {
        const icon = resolveIcon(name)!;
        expect(icon.width).toBe(24);
        expect(icon.height).toBe(24);
      });

      it("strokes rather than fills, like the set it sits in", () => {
        // A hand-drawn body that fills would read as a solid blob beside 1,843
        // outlines — the one way these can be wrong that no render test catches.
        const { body } = resolveIcon(name)!;
        expect(body).toContain('stroke="currentColor"');
        expect(body).toContain('fill="none"');
        expect(body).toContain('stroke-width="2"');
      });

      it("is balanced markup", () => {
        const { body } = resolveIcon(name)!;
        const opens = (body.match(/<g[\s>]/g) ?? []).length;
        const closes = (body.match(/<\/g>/g) ?? []).length;
        expect(opens).toBe(closes);
        // Self-closing children only — an unclosed <path> swallows its siblings.
        expect(body.replace(/<\/?g[^>]*>/g, "")).toMatch(/^(<(path|rect|circle)\b[^>]*\/>)+$/);
      });

      it("keeps its geometry inside the viewBox", () => {
        const { body } = resolveIcon(name)!;
        // Every coordinate in these bodies is absolute and small; anything
        // outside 0–24 clips on render, which a passing snapshot never shows.
        for (const n of body.match(/-?\d+(\.\d+)?/g) ?? []) {
          expect(Math.abs(Number(n))).toBeLessThanOrEqual(24);
        }
      });
    });
  }

  it("is what makes the names type-check", () => {
    // `ShippedIconName` is derived from CUSTOM_ICONS' keys, so adding an icon
    // widens the union with no second list to update. Compiles ⇒ derived.
    const name: IconName = "passkey";
    expect(resolveIcon(name)).not.toBeNull();
  });
});

describe("the brand marks", () => {
  const BRANDS = ["brand-google", "brand-github", "brand-apple"] as const;

  for (const name of BRANDS) {
    it(`${name} resolves`, () => {
      expect(resolveIcon(name)).not.toBeNull();
    });
  }

  it("fills rather than strokes — a brand mark is a solid shape", () => {
    // The opposite of the rule for the hand-drawn four. `<Icon>` sets no fill on
    // the wrapper, so a brand body that omitted it would render as SVG's default
    // black and ignore `currentColor` — invisible on a dark button.
    for (const name of BRANDS) {
      expect(resolveIcon(name)!.body).toContain('fill="currentColor"');
    }
  });

  it("keeps Lucide's stroke github and apple reachable", () => {
    // The `brand-` prefix exists so a page picks a style deliberately rather than
    // having one silently shadow the other.
    expect(resolveIcon("github")!.body).not.toBe(resolveIcon("brand-github")!.body);
    expect(resolveIcon("apple")!.body).not.toBe(resolveIcon("brand-apple")!.body);
  });

  it("fills the gap that motivated this — Lucide has no google", () => {
    expect(resolveIcon("google")).toBeNull();
    expect(resolveIcon("brand-google")).not.toBeNull();
  });
});

describe("registerIcons()", () => {
  it("adds an icon the bundled set does not have", () => {
    registerIcons({ "acme-wordmark": { body: '<path d="M0 0h24v24H0z"/>' } });
    const { html } = Icon({ name: "acme-wordmark" as never });
    expect(html).toContain('<path d="M0 0h24v24H0z"/>');
    expect(html).toContain('viewBox="0 0 24 24"');
  });

  it("shadows a bundled icon of the same name", () => {
    const before = resolveIcon("inbox")!.body;
    registerIcons({ inbox: { body: "<circle/>" } });
    expect(resolveIcon("inbox")!.body).toBe("<circle/>");
    expect(resolveIcon("inbox")!.body).not.toBe(before);
  });

  it("honours a custom viewBox", () => {
    registerIcons({ wide: { body: "<path/>", width: 48, height: 16 } });
    const icon = resolveIcon("wide")!;
    expect(icon.width).toBe(48);
    expect(icon.height).toBe(16);
  });
});

describe("isIconName()", () => {
  it("accepts a name-shaped string", () => {
    expect(isIconName("chevron-right")).toBe(true);
    expect(isIconName("inbox")).toBe(true);
  });

  it("rejects what cannot be a name", () => {
    expect(isIconName("Inbox")).toBe(false);
    expect(isIconName("lucide:inbox")).toBe(false);
    expect(isIconName(42)).toBe(false);
    expect(isIconName(undefined)).toBe(false);
  });
});
