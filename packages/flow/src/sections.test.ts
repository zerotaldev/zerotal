import { describe, it, expect } from "bun:test";
import {
  createSectionStore,
  runWithSections,
  publishSection,
  reserveSection,
  resolveSections,
  getSectionStore,
} from "./sections.ts";
import { SectionContent, SectionOutlet } from "./components.ts";

describe("section store", () => {
  it("fills an outlet with content published anywhere in the request", () => {
    const store = createSectionStore();
    const html = runWithSections(store, () => {
      const outlet = reserveSection("toolbar", "");
      publishSection("toolbar", "<button>Save</button>");
      return `<header>${outlet}</header>`;
    });

    expect(resolveSections(html, store)).toBe("<header><button>Save</button></header>");
  });

  it("fills an outlet reserved AFTER the content was published", () => {
    // The real arrangement: the page publishes, then the layout wraps it and
    // reserves. Resolution happens last precisely so this direction works.
    const store = createSectionStore();
    const html = runWithSections(store, () => {
      publishSection("title", "Dashboard");
      return `<h1>${reserveSection("title", "Untitled")}</h1>`;
    });

    expect(resolveSections(html, store)).toBe("<h1>Dashboard</h1>");
  });

  it("accumulates multiple publications in order", () => {
    const store = createSectionStore();
    const html = runWithSections(store, () => {
      publishSection("actions", "<a>One</a>");
      publishSection("actions", "<a>Two</a>");
      return reserveSection("actions", "");
    });

    expect(resolveSections(html, store)).toBe("<a>One</a><a>Two</a>");
  });

  it("uses the fallback when nothing was published", () => {
    const store = createSectionStore();
    const html = runWithSections(store, () => reserveSection("empty", "<span>None</span>"));
    expect(resolveSections(html, store)).toBe("<span>None</span>");
  });

  it("keeps two concurrent requests apart", async () => {
    const a = createSectionStore();
    const b = createSectionStore();

    const render = (store: ReturnType<typeof createSectionStore>, value: string) =>
      runWithSections(store, async () => {
        const outlet = reserveSection("t", "");
        // Yield so the two renders genuinely interleave rather than running to
        // completion one after the other.
        await Bun.sleep(1);
        publishSection("t", value);
        return outlet;
      });

    const [htmlA, htmlB] = await Promise.all([render(a, "A"), render(b, "B")]);

    expect(resolveSections(htmlA, a)).toBe("A");
    expect(resolveSections(htmlB, b)).toBe("B");
  });

  it("gives each request an unguessable, distinct token nonce", () => {
    expect(createSectionStore().nonce).not.toBe(createSectionStore().nonce);
  });

  it("does not let published markup masquerade as another outlet's token", () => {
    const store = createSectionStore();
    const html = runWithSections(store, () => {
      const first = reserveSection("a", "");
      const second = reserveSection("b", "fallback-b");
      // Content that names the *next* outlet's token. Resolution walks outlets in
      // order, so this would fill outlet "b" if substituted content were rescanned.
      publishSection("a", `<!--flow-section:${store.nonce}:1-->`);
      return `${first}|${second}`;
    });

    const out = resolveSections(html, store);
    expect(out).toBe(`<!--flow-section:${store.nonce}:1-->|fallback-b`);
  });

  it("no-ops outside a request instead of throwing", () => {
    // A WebSocket patch re-renders a component with no document to resolve
    // against; the outlet must fall back rather than fail.
    expect(getSectionStore()).toBeUndefined();
    expect(() => publishSection("x", "<b>hi</b>")).not.toThrow();
    expect(reserveSection("x", "<i>default</i>")).toBe("<i>default</i>");
  });
});

describe("<SectionContent> / <SectionOutlet>", () => {
  it("moves markup from the content site to the outlet", () => {
    const store = createSectionStore();
    const html = runWithSections(store, () => {
      const layout = SectionOutlet({ name: "toolbar" }).html;
      const page = SectionContent({
        name: "toolbar",
        children: { html: "<button>Publish</button>" },
      }).html;
      return `<header>${layout}</header><main>${page}</main>`;
    });

    const out = resolveSections(html, store);
    expect(out).toBe("<header><button>Publish</button></header><main></main>");
  });

  it("renders nothing where the content is declared", () => {
    const store = createSectionStore();
    runWithSections(store, () => {
      expect(SectionContent({ name: "t", children: { html: "<b>x</b>" } }).html).toBe("");
    });
  });

  it("escapes a plain-text child rather than trusting it as markup", () => {
    const store = createSectionStore();
    const html = runWithSections(store, () => {
      const outlet = SectionOutlet({ name: "title" }).html;
      SectionContent({ name: "title", children: "<script>alert(1)</script>" });
      return outlet;
    });

    const out = resolveSections(html, store);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders outlet children as the default", () => {
    const store = createSectionStore();
    const html = runWithSections(
      store,
      () => SectionOutlet({ name: "gone", children: { html: "<em>None</em>" } }).html,
    );
    expect(resolveSections(html, store)).toBe("<em>None</em>");
  });
});
