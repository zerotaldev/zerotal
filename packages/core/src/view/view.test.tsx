/** @jsxImportSource @zerotal/core */
import { describe, it, expect } from "bun:test";
import { Fragment, SafeHtml, safe, esc, Raw } from "./index.ts";

// Convenience: unwrap SafeHtml → plain string for assertions.
const str = (v: SafeHtml) => v.toString();

// ── SafeHtml type ─────────────────────────────────────────────────────────────

describe("SafeHtml", () => {
  it("jsx expressions produce SafeHtml instances, not plain strings", () => {
    const result = <div>hello</div>;
    expect(result).toBeInstanceOf(SafeHtml);
    expect(typeof result).toBe("object");
  });

  it("toString() yields the rendered HTML", () => {
    expect(str(<span>world</span>)).toBe("<span>world</span>");
  });
});

// ── Primitive elements ────────────────────────────────────────────────────────

describe("HTML elements", () => {
  it("renders a simple element", () => {
    expect(str(<div>hello</div>)).toBe("<div>hello</div>");
  });

  it("renders an element with no children", () => {
    expect(str(<span></span>)).toBe("<span></span>");
  });

  it("renders void elements without closing tag", () => {
    expect(str(<br />)).toBe("<br>");
    expect(str(<hr />)).toBe("<hr>");
    expect(str(<img src="/logo.png" alt="Logo" />)).toBe('<img src="/logo.png" alt="Logo">');
    expect(str(<input type="text" />)).toBe('<input type="text">');
    expect(str(<link rel="stylesheet" href="/app.css" />)).toBe(
      '<link rel="stylesheet" href="/app.css">',
    );
    expect(str(<meta charset="utf-8" />)).toBe('<meta charset="utf-8">');
  });

  it("renders nested elements", () => {
    const result = str(
      <div>
        <h1>Title</h1>
        <p>Body</p>
      </div>,
    );
    expect(result).toBe("<div><h1>Title</h1><p>Body</p></div>");
  });

  it("renders a number child without escaping", () => {
    expect(str(<span>{42}</span>)).toBe("<span>42</span>");
  });

  it("renders multiple children", () => {
    expect(
      str(
        <ul>
          <li>a</li>
          <li>b</li>
        </ul>,
      ),
    ).toBe("<ul><li>a</li><li>b</li></ul>");
  });
});

// ── AUTO-ESCAPING (the critical security layer) ───────────────────────────────

describe("Auto-escaping of string children", () => {
  it("escapes < and > in text nodes", () => {
    const bad = "<script>alert(1)</script>";
    expect(str(<p>{bad}</p>)).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("escapes & in text nodes", () => {
    expect(str(<p>{"fish & chips"}</p>)).toBe("<p>fish &amp; chips</p>");
  });

  it('escapes " in text nodes', () => {
    expect(str(<p>{'say "hi"'}</p>)).toBe("<p>say &quot;hi&quot;</p>");
  });

  it("escapes ' in text nodes", () => {
    expect(str(<p>{"it's fine"}</p>)).toBe("<p>it&#x27;s fine</p>");
  });

  it("auto-escapes a full XSS payload", () => {
    const xss = '"><img src=x onerror=alert(1)>';
    expect(str(<div>{xss}</div>)).toBe("<div>&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</div>");
  });

  it("does NOT double-escape SafeHtml produced by nested JSX", () => {
    const child = <strong>Hello &amp; World</strong>;
    // child.value is already "<strong>Hello &amp; World</strong>"
    // Embedding it in a parent must NOT escape the < > &
    expect(str(<div>{child}</div>)).toBe("<div><strong>Hello &amp; World</strong></div>");
  });

  it("does NOT double-escape a deeply nested tree", () => {
    const inner = <em>{"A & B"}</em>; // auto-escapes: <em>A &amp; B</em>
    const outer = <p>{inner}</p>; // passes SafeHtml through unchanged
    expect(str(outer)).toBe("<p><em>A &amp; B</em></p>");
  });

  it("does not escape numbers (they are inert)", () => {
    expect(str(<td>{1000}</td>)).toBe("<td>1000</td>");
  });
});

// ── Attribute handling ────────────────────────────────────────────────────────

describe("Attributes", () => {
  it("renders string attributes", () => {
    expect(
      str(
        <div id="main" class="container">
          x
        </div>,
      ),
    ).toBe('<div id="main" class="container">x</div>');
  });

  it("maps className to class", () => {
    expect(str(<div className="bg-red-500">x</div>)).toBe('<div class="bg-red-500">x</div>');
  });

  it("maps htmlFor to for", () => {
    expect(str(<label htmlFor="email">Email</label>)).toBe('<label for="email">Email</label>');
  });

  it("renders boolean true attributes without a value", () => {
    expect(str(<input disabled />)).toBe("<input disabled>");
    expect(str(<input required />)).toBe("<input required>");
  });

  it("omits false boolean attributes", () => {
    expect(str(<input disabled={false} />)).toBe("<input>");
  });

  it("omits null and undefined attributes", () => {
    expect(str(<div id={undefined}>x</div>)).toBe("<div>x</div>");
    expect(str(<div id={null as unknown as string}>x</div>)).toBe("<div>x</div>");
  });

  it("escapes & < > \" ' in attribute values", () => {
    // Must be a variable — a bare > inside a JSX attribute confuses the parser.
    const title = "A & B < C > D \"E\" 'F'";
    expect(str(<div title={title}>x</div>)).toBe(
      `<div title="A &amp; B &lt; C &gt; D &quot;E&quot; &#x27;F&#x27;">x</div>`,
    );
  });

  it("renders numeric attribute values", () => {
    expect(str(<input tabIndex={3} />)).toBe('<input tabIndex="3">');
  });

  it("ignores the key prop", () => {
    expect(str(<li key="a">item</li>)).toBe("<li>item</li>");
  });
});

// ── Conditional rendering ─────────────────────────────────────────────────────

describe("Conditional rendering", () => {
  it("renders nothing for false children", () => {
    const show = false;
    expect(str(<div>{show && <span>hi</span>}</div>)).toBe("<div></div>");
  });

  it("renders nothing for null children", () => {
    expect(str(<div>{null}</div>)).toBe("<div></div>");
  });

  it("renders nothing for undefined children", () => {
    expect(str(<div>{undefined}</div>)).toBe("<div></div>");
  });

  it("renders nothing for raw boolean true", () => {
    expect(str(<div>{true}</div>)).toBe("<div></div>");
  });

  it("renders ternary correctly", () => {
    const isAdmin = true;
    expect(str(<div>{isAdmin ? <span>Admin</span> : <span>User</span>}</div>)).toBe(
      "<div><span>Admin</span></div>",
    );
  });
});

// ── Array children / map ──────────────────────────────────────────────────────

describe("Array children", () => {
  it("renders array of elements from map", () => {
    const items = ["a", "b", "c"];
    const result = str(
      <ul>
        {items.map((i) => (
          <li>{i}</li>
        ))}
      </ul>,
    );
    // 'a', 'b', 'c' are plain strings → auto-escaped (harmless here)
    expect(result).toBe("<ul><li>a</li><li>b</li><li>c</li></ul>");
  });

  it("auto-escapes string items in a mapped list", () => {
    const items = ["<Alice>", "&Bob"];
    const result = str(
      <ul>
        {items.map((i) => (
          <li>{i}</li>
        ))}
      </ul>,
    );
    expect(result).toBe("<ul><li>&lt;Alice&gt;</li><li>&amp;Bob</li></ul>");
  });
});

// ── Function components ───────────────────────────────────────────────────────

describe("Function components", () => {
  function Greeting({ name }: { name: string }): SafeHtml {
    return <p>Hello, {name}!</p>;
  }

  it("calls the component function and auto-escapes its props", () => {
    expect(str(<Greeting name="<Alice>" />)).toBe("<p>Hello, &lt;Alice&gt;!</p>");
  });

  it("nests function components", () => {
    function Card({ title, children }: { title: string; children?: unknown }): SafeHtml {
      return (
        <div className="card">
          <h2>{title}</h2>
          <div className="body">{children as SafeHtml}</div>
        </div>
      );
    }
    const result = str(
      <Card title="News">
        <p>Content</p>
      </Card>,
    );
    expect(result).toBe(
      '<div class="card"><h2>News</h2><div class="body"><p>Content</p></div></div>',
    );
  });

  it("renders a full page layout component", () => {
    function Layout({ title, children }: { title: string; children?: unknown }): SafeHtml {
      return (
        <html lang="en">
          <head>
            <title>{title}</title>
          </head>
          <body>{children as SafeHtml}</body>
        </html>
      );
    }
    const result = str(
      <Layout title="Home">
        <h1>Hello</h1>
      </Layout>,
    );
    expect(result).toBe(
      '<html lang="en"><head><title>Home</title></head><body><h1>Hello</h1></body></html>',
    );
  });
});

// ── Fragment ──────────────────────────────────────────────────────────────────

describe("Fragment", () => {
  it("renders children without a wrapper element", () => {
    const result = str(
      <Fragment>
        <p>first</p>
        <p>second</p>
      </Fragment>,
    );
    expect(result).toBe("<p>first</p><p>second</p>");
  });

  it("works with shorthand <> syntax", () => {
    const result = str(
      <>
        <span>a</span>
        <span>b</span>
      </>,
    );
    expect(result).toBe("<span>a</span><span>b</span>");
  });
});

// ── Raw HTML escape hatches ───────────────────────────────────────────────────

describe("dangerouslySetInnerHTML", () => {
  it("injects raw HTML without escaping", () => {
    const raw = "<strong>bold</strong> & more";
    const result = str(<div dangerouslySetInnerHTML={{ __html: raw }} />);
    expect(result).toBe("<div><strong>bold</strong> & more</div>");
  });
});

describe("safe() helper", () => {
  it("wraps a string as SafeHtml so it passes through unescaped", () => {
    const html = "<em>pre-rendered</em>";
    expect(str(<div>{safe(html)}</div>)).toBe("<div><em>pre-rendered</em></div>");
  });

  it("does NOT escape the wrapped value", () => {
    expect(str(<p>{safe("<b>raw</b>")}</p>)).toBe("<p><b>raw</b></p>");
  });
});

describe("Raw component", () => {
  it("injects raw HTML as a component", () => {
    const md = "<p>Hello <strong>world</strong></p>";
    expect(
      str(
        <article>
          <Raw html={md} />
        </article>,
      ),
    ).toBe("<article><p>Hello <strong>world</strong></p></article>");
  });
});

// ── esc() utility ─────────────────────────────────────────────────────────────

describe("esc()", () => {
  it("escapes all HTML special characters", () => {
    expect(esc('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
    expect(esc("a & b")).toBe("a &amp; b");
    expect(esc("it's")).toBe("it&#x27;s");
  });

  it("handles null / undefined gracefully", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });

  it("handles numbers", () => {
    expect(esc(42)).toBe("42");
  });
});

// ── Realistic full-page example ───────────────────────────────────────────────

describe("Full page rendering", () => {
  interface User {
    id: number;
    name: string;
  }

  function UserRow({ user }: { user: User }): SafeHtml {
    // name comes from a DB query — in a real app it could contain HTML
    return (
      <tr>
        <td>{user.id}</td>
        <td>{user.name}</td>
      </tr>
    );
  }

  function UsersPage({ users }: { users: User[] }): SafeHtml {
    return (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Users</title>
        </head>
        <body>
          <h1>Users</h1>
          {users.length === 0 ? (
            <p>No users found.</p>
          ) : (
            <table>
              <tbody>
                {users.map((u) => (
                  <UserRow user={u} />
                ))}
              </tbody>
            </table>
          )}
        </body>
      </html>
    );
  }

  it("renders a realistic multi-component page", () => {
    const users: User[] = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const result = str(UsersPage({ users }));
    expect(result).toContain("<h1>Users</h1>");
    expect(result).toContain("<td>Alice</td>");
    expect(result).toContain("<td>Bob</td>");
    expect(result).toContain('<meta charset="utf-8">');
    expect(result).toContain("<title>Users</title>");
  });

  it("auto-escapes names that contain HTML", () => {
    const users: User[] = [{ id: 1, name: "<b>Hacker</b>" }];
    const result = str(UsersPage({ users }));
    expect(result).toContain("<td>&lt;b&gt;Hacker&lt;/b&gt;</td>");
    expect(result).not.toContain("<b>Hacker</b>");
  });

  it("renders the empty state", () => {
    const result = str(UsersPage({ users: [] }));
    expect(result).toContain("<p>No users found.</p>");
    expect(result).not.toContain("<table>");
  });
});

// ── defineLayout ──────────────────────────────────────────────────────────────

import { defineLayout } from "./index.ts";

function Shell({ children, title }: { children?: unknown; title: string }) {
  return (
    <html>
      <head>
        <title>{title}</title>
      </head>
      <body>{children}</body>
    </html>
  );
}

const wrap = defineLayout(Shell);

describe("defineLayout", () => {
  it("wraps a page component inside the layout", () => {
    const AboutPage = wrap<{ title: string }>(({ title }) => (
      <main>
        <h1>{title}</h1>
      </main>
    ));
    const html = str(AboutPage({ title: "About" }));
    expect(html).toContain("<title>About</title>");
    expect(html).toContain("<main><h1>About</h1></main>");
    expect(html).toContain("<html>");
    expect(html).toContain("</html>");
  });

  it("merges layout and page props", () => {
    const ProfilePage = wrap<{ title: string; username: string }>(({ username }) => (
      <p>{username}</p>
    ));
    const html = str(ProfilePage({ title: "Profile", username: "alice" }));
    expect(html).toContain("<title>Profile</title>");
    expect(html).toContain("<p>alice</p>");
  });

  it("auto-escapes page output that comes from user data", () => {
    const DangerPage = wrap<{ title: string }>(({ title }) => <span>{title}</span>);
    const html = str(DangerPage({ title: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
