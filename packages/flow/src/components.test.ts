import { describe, it, expect } from "bun:test";
import {
  Link,
  Head,
  Persist,
  Title,
  Modal,
  Flash,
  Errors,
  ErrorMessage,
  Dropdown,
  Tabs,
  InfiniteScroll,
  Loading,
  Skeleton,
  Pager,
  Tooltip,
  Alert,
  Table,
} from "./components.ts";
import { paginate } from "./pagination.ts";
import { jsx } from "./jsx-runtime.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

describe("<Link>", () => {
  it("emits a navigate anchor with href + children", () => {
    const n = Link({ href: "/posts", children: "Posts" });
    expect(n.html).toContain('href="/posts"');
    expect(n.html).toContain("flow:navigate");
    expect(n.html).toContain(">Posts</a>");
    expect(n.html).not.toContain("flow:navigate.hover");
    expect(n.html).not.toContain("flow:current.ignore");
  });

  it("hover adds prefetch; current={false} opts out of data-current; extra props pass through", () => {
    const n = Link({ href: "/x", hover: true, current: false, class: "nav", children: "X" });
    expect(n.html).toContain("flow:navigate.hover");
    expect(n.html).toContain("flow:current.ignore");
    expect(n.html).toContain('class="nav"');
  });

  it("current={true} forces the active state on (data-current) and persists it across navigation", () => {
    const n = Link({ href: "/x", current: true, children: "X" });
    expect(n.html).toContain("flow:current.force"); // runtime keeps data-current on this link
    expect(n.html).toContain("data-current"); // active on first paint, before the runtime runs
    expect(n.html).not.toContain("flow:current.ignore");
  });
});

describe("<Head>", () => {
  it("wraps content in a head template the bridge hoists", () => {
    const n = Head({ children: jsx("title", { children: "Dashboard" }) as HtmlNode });
    expect(n.html).toContain("<template data-flow-head>");
    expect(n.html).toContain("<title>Dashboard</title>");
    expect(n.html).toContain("</template>");
  });
});

describe("<Persist>", () => {
  it("emits a named wrapper that morph ignores", () => {
    const n = Persist({ name: "player", children: jsx("audio", { controls: true }) as HtmlNode });
    expect(n.html).toContain('data-flow-persist="player"');
    expect(n.html).toContain("flow:ignore");
    expect(n.html).toContain("<audio");
  });
});

describe("<Title>", () => {
  it("wraps a <title> in a head template", () => {
    const n = Title({ children: "Dashboard" });
    expect(n.html).toContain("<template data-flow-head>");
    expect(n.html).toContain("<title>Dashboard</title>");
  });
});

describe("<Modal>", () => {
  it("renders a dialog with backdrop, panel, title and close button", () => {
    const n = Modal({ show: true, title: "Edit", children: "Body" });
    expect(n.html).toContain('role="dialog"');
    expect(n.html).toContain('aria-modal="true"');
    expect(n.html).toContain("bg-black/50");
    expect(n.html).toContain("flow:transition");
    expect(n.html).toContain("Edit");
    expect(n.html).toContain("Body");
    expect(n.html).toContain('aria-label="Close"');
  });

  it("a literal-false show hides the overlay on first paint", () => {
    const n = Modal({ show: false, children: "x" });
    expect(n.html).toContain("display: none");
  });
});

describe("<Flash>", () => {
  it("emits a positioned container and a listener script", () => {
    const n = Flash({ position: "top-center", duration: 2000 });
    expect(n.html).toContain('id="flow-flash"');
    expect(n.html).toContain('data-duration="2000"');
    // Container positioning is inline (Tailwind classes would be purged in apps that
    // don't scan the flow package) — top-center anchors via a transform.
    expect(n.html).toContain("position: fixed");
    expect(n.html).toContain("transform: translateX(-50%)");
    expect(n.html).toContain("addEventListener('flow:flash'");
  });
});

describe("<Errors>", () => {
  it("emits a hidden flow:errors list, optionally scoped with only", () => {
    const n = Errors({ only: ["email", "name"] });
    expect(n.html).toContain("flow:errors");
    expect(n.html).toContain('flow:errors.only="email,name"');
    expect(n.html).toContain('role="alert"');
    expect(n.html).toContain("display: none");
  });
});

describe("<ErrorMessage>", () => {
  it("emits a self-hiding span bound to a field error (via `for`)", () => {
    const sentinel = { __isErrorField: true, __field: "email", __value: "Required" };
    const n = ErrorMessage({ for: sentinel });
    expect(n.html).toContain('flow:error="email"');
    expect(n.html).toContain('flow:show="errors.email"');
    expect(n.html).toContain("Required");
    expect(n.html.startsWith("<span")).toBe(true);
  });
});

describe("<Dropdown>", () => {
  it("is a keyboard-navigable menu (flowMenu) with roles, outside-click + escape", () => {
    const n = Dropdown({
      label: "Options",
      align: "right",
      children: jsx("a", { href: "/x", children: "Item" }) as HtmlNode,
    });
    expect(n.html).toContain('x-data="flowMenu()"');
    expect(n.html).toContain('aria-haspopup="menu"');
    expect(n.html).toContain('role="menu"');
    expect(n.html).toContain('x-on:click="toggle()"');
    expect(n.html).toContain('x-on:keydown="onButtonKey($event)"');
    expect(n.html).toContain('x-on:keydown="onKey($event)"');
    expect(n.html).toContain('x-on:click.outside="close(false)"');
    expect(n.html).toContain("right-0");
    expect(n.html).toContain("Options");
    expect(n.html).toContain("Item");
  });
});

describe("<Tooltip>", () => {
  it("shows content on hover/focus with aria-describedby wiring", () => {
    const n = Tooltip({ content: "Copy", children: jsx("button", { children: "📋" }) as HtmlNode });
    expect(n.html).toContain('x-on:mouseenter="open = true"');
    expect(n.html).toContain('x-on:focusin="open = true"');
    expect(n.html).toContain('role="tooltip"');
    expect(n.html).toContain(":aria-describedby=\"$id('flow-tooltip')\"");
    expect(n.html).toContain("Copy");
  });
});

describe("<Alert>", () => {
  it("renders a variant alert with a dismiss control", () => {
    const n = Alert({ variant: "success", dismissible: true, children: "Saved!" });
    expect(n.html).toContain('role="status"'); // success → polite
    expect(n.html).toContain('x-data="{ shown: true }"');
    expect(n.html).toContain('x-show="shown"');
    expect(n.html).toContain('x-on:click="shown = false"');
    expect(n.html).toContain("emerald"); // success palette
    expect(n.html).toContain("Saved!");
  });
  it("uses role=alert for error/warning", () => {
    expect(Alert({ variant: "error", children: "Boom" }).html).toContain('role="alert"');
  });
});

describe("<Table>", () => {
  it("renders sortable headers as navigate links and custom cells", () => {
    const rows = [
      { id: 1, name: "Ann", age: 30 },
      { id: 2, name: "Bo", age: 25 },
    ];
    const n = Table({
      columns: [
        { key: "name", label: "Name", sortable: true },
        { key: "age", label: "Age", render: (r: any) => `${r.age}y` },
      ],
      rows,
      sortBy: "name",
      sortDir: "asc",
      params: { q: "x" },
    });
    expect(n.html).toContain("<table");
    expect(n.html).toContain('aria-sort="ascending"'); // active col
    expect(n.html).toContain("flow:navigate");
    expect(n.html).toContain("sortBy=name&amp;sortDir=desc&amp;q=x"); // toggles dir + keeps params
    expect(n.html).toContain("▲");
    expect(n.html).toContain("Ann");
    expect(n.html).toContain("30y"); // custom render
  });
});

describe("<Tabs>", () => {
  it("emits Alpine tab state with a button bar and panels", () => {
    const n = Tabs({
      items: [
        { label: "A", content: "AA", name: "a" },
        { label: "B", content: "BB", name: "b" },
      ],
    });
    // Tab names go into the Alpine expression as JSON literals — hand-quoting them made a
    // user-controlled name (a workspace slug) executable in every viewer's browser. The
    // browser decodes &quot; before Alpine sees it, so the expression is `tab === "a"`.
    expect(n.html).toContain('x-data="flowTabs({ tab: &quot;a&quot; })"');
    expect(n.html).toContain('role="tablist"');
    expect(n.html).toContain('role="tab"');
    expect(n.html).toContain('role="tabpanel"');
    expect(n.html).toContain('x-on:click="tab = &quot;b&quot;"');
    expect(n.html).toContain('x-show="tab === &quot;a&quot;"');
    expect(n.html).toContain("AA");
    expect(n.html).toContain("BB");
  });

  it("cannot be made to execute a crafted tab name", () => {
    const payload = "'); alert(1); ('";
    const n = Tabs({ items: [{ label: "X", content: "XX", name: payload }] });

    // Every Alpine expression carries the name inside a JSON string literal, so the payload
    // stays an operand. Hand-quoting it as `tab = '<name>'` let it close the literal and
    // append statements — stored XSS from, say, a user-chosen workspace slug.
    for (const attr of ['x-on:click="tab = ', 'x-show="tab === ', ':aria-selected="tab === ']) {
      const start = n.html.indexOf(attr);
      expect(start).toBeGreaterThan(-1);
      const value = n.html.slice(start + attr.length);
      expect(value.startsWith(`&quot;${payload}&quot;`)).toBe(true);
    }
  });
});

describe("<InfiniteScroll>", () => {
  it("emits a flow:intersect sentinel bound to the action", () => {
    function loadMore() {}
    const n = InfiniteScroll({ onMore: loadMore });
    expect(n.html).toContain('flow:intersect="loadMore"');
    expect(n.html).toContain("Loading more");
  });

  it("show={false} renders nothing (past the end)", () => {
    function loadMore() {}
    expect(InfiniteScroll({ onMore: loadMore, show: false }).html).toBe("");
    expect(InfiniteScroll({ onMore: loadMore, show: true }).html).toContain(
      'flow:intersect="loadMore"',
    );
  });
});

describe("<Pager>", () => {
  it("renders prev/numbered/next navigate links from a paginator", () => {
    const p = paginate(Array.from({ length: 50 }), 3, 10); // 5 pages, current 3
    const n = Pager({ paginator: p, params: { q: "x" }, hover: true });
    expect(n.html).toContain('aria-label="Pagination"');
    expect(n.html).toContain("flow:navigate");
    expect(n.html).toContain("flow:navigate.hover");
    expect(n.html).toContain("page=2&amp;q=x"); // prev keeps params (escaped &)
    expect(n.html).toContain("page=4&amp;q=x"); // next
    expect(n.html).toContain('aria-current="page"'); // current page 3
    expect(n.html).toContain("Prev");
    expect(n.html).toContain("Next");
  });

  it("renders nothing for a single page", () => {
    expect(Pager({ paginator: paginate([1, 2], 1, 10) }).html).toBe("");
  });
});

describe("<Loading>", () => {
  it("shows children while loading, scoped to a target", () => {
    const n = Loading({ target: "save", children: "Saving…" });
    expect(n.html).toContain("flow:loading");
    expect(n.html).toContain('flow:target="save"');
    expect(n.html).toContain("Saving");
  });

  it("hide inverts to hide-while-loading; delay defers the show", () => {
    expect(Loading({ hide: true, children: "x" }).html).toContain("flow:loading.remove");
    expect(Loading({ delay: true, children: "x" }).html).toContain("flow:loading.delay");
  });

  it("skeleton renders a <Skeleton> as the loading content", () => {
    const n = Loading({ skeleton: true });
    expect(n.html).toContain("flow:loading");
    expect(n.html).toContain("flow-skeleton");
  });
});

describe("<Skeleton>", () => {
  it("renders a single pulsing bar with width/height/radius", () => {
    const n = Skeleton({ width: "60%", height: "1.5rem", rounded: true });
    expect(n.html).toContain('class="flow-skeleton"');
    expect(n.html).toContain("width:60%");
    expect(n.html).toContain("height:1.5rem");
    expect(n.html).toContain("border-radius:9999px");
  });

  it("renders N stacked bars in multi-line mode, last one shorter", () => {
    const n = Skeleton({ lines: 3 });
    expect(n.html.match(/flow-skeleton/g)?.length).toBe(4); // group class + 3 bars
    expect(n.html).toContain("width:60%"); // the shortened last line
  });
});
