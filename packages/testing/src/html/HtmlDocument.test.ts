import { describe, expect, test } from "bun:test";
import { HtmlDocument, HtmlElement, parseHtml } from "./HtmlDocument.ts";
import { TestResponse } from "../TestResponse.ts";

const PAGE = `<!doctype html>
<html>
<head><title>Projects &mdash; Acme</title><script>if (a < b) document.write("Hidden")</script></head>
<body>
  <header><nav aria-label="Main"><a href="/">Home</a> <a href="/projects" class="text-sm font-medium">Projects</a></nav></header>
  <main>
    <h1>Projects</h1>
    <ul aria-label="Projects">
      <li><a href="/projects/1/edit">Website relaunch</a> <span class="badge">Active</span>
          <a href="/projects/1/edit" aria-label="Edit Website relaunch"><svg aria-hidden="true"></svg></a>
      <li><a href="http://localhost/projects/2/edit">Billing &amp; invoices</a> <span>Done</span>
    </ul>
    <p>Showing <span>1</span>–<span>2</span> of 2 projects</p>
    <p hidden>Secret note</p>
    <template><p>Template text</p></template>
    <div role="group" aria-label="Active"><p>Active</p><p>1</p></div>
  </main>
</body>
</html>`;

const FORM = `<title>Profile — Acme</title>
<form id="profile" method="post" action="/settings/profile">
  <input type="hidden" name="_token" value="abc">
  <label for="field-name">Name</label>
  <input id="field-name" name="name" value="Ada &quot;Countess&quot; Lovelace">
  <label for="field-email">Email</label>
  <input id="field-email" type="email" name="email" value="" aria-invalid="true" aria-describedby="field-email-error">
  <p id="field-email-error">The email field is required.</p>
  <label for="field-bio">Bio</label>
  <textarea id="field-bio" name="bio">
Mathematician &lt;and&gt; writer</textarea>
  <label for="field-status">Status</label>
  <select id="field-status" name="status"><option value="draft">Draft<option value="active" selected>Active</select>
  <label><input type="checkbox" name="newsletter" checked> Send me the newsletter</label>
  <input type="radio" name="plan" value="free" aria-label="Free">
  <input type="radio" name="plan" value="pro" checked aria-label="Pro">
  <label for="field-website">Website</label>
  <input id="field-website" name="website" aria-describedby="field-website-hint">
  <p id="field-website-hint">Optional.</p>
  <p id="field-website-error" hidden></p>
  <button type="button">Cancel</button>
  <button>Save</button>
</form>
<button type="submit" form="profile">Outside</button>
<form method="post" action="/logout"><button>Sign out</button></form>`;

describe("parsing", () => {
  test("applies the end tags HTML leaves implied", () => {
    const page = parseHtml("<ul><li>one<li>two</ul><p>first<p>second<div>block</div>");
    expect(page.findAll("li").map((li) => li.text())).toEqual(["one", "two"]);
    expect(page.findAll("p").map((p) => p.text())).toEqual(["first", "second"]);
    expect(page.get("div").parent()).toBeNull();
  });

  test("keeps a nested list inside its item", () => {
    const page = parseHtml("<ul><li>a<ul><li>a1<li>a2</ul><li>b</ul>");
    expect(page.findAll("body > ul > li, ul:not(ul ul) > li").length).toBeGreaterThan(0);
    expect(page.findAll("ul ul li").map((li) => li.text())).toEqual(["a1", "a2"]);
    expect(page.count("li")).toBe(4);
  });

  test("decodes character references in text and attributes", () => {
    const page = parseHtml(
      `<a title="&quot;x&quot; &#39;y&#x27;">A &amp; B &copy; &unknown; &lt;3</a>`,
    );
    expect(page.get("a").text()).toBe("A & B © &unknown; <3");
    expect(page.get("a").attr("title")).toBe(`"x" 'y'`);
  });

  test("reads void and self-closed elements without swallowing what follows", () => {
    const page = parseHtml(
      `<p>a<br>b<img src="x.png" alt="X"><svg><path d="M0"/></svg><span>c</span></p>`,
    );
    expect(page.get("p").text()).toBe("a b c");
    expect(page.get("span").parent()?.tag).toBe("p");
  });

  test("writes the tree back out", () => {
    const page = parseHtml(`<p class="x">a &amp; <b>b</b><br></p>`);
    expect(page.get("p").html()).toBe(`<p class="x">a &amp; <b>b</b><br></p>`);
  });
});

describe("reading a page", () => {
  const page = parseHtml(PAGE);

  test("the title, and the text a visitor reads", () => {
    expect(page.title()).toBe("Projects — Acme");
    const text = page.text();
    expect(text).toContain("Showing 1–2 of 2 projects");
    expect(text).not.toContain("Hidden");
    expect(text).not.toContain("Secret note");
    expect(text).not.toContain("Template text");
    expect(page.getByRole("group", { name: "Active" }).text()).toBe("Active 1");
  });

  test("CSS selectors", () => {
    expect(page.count("main li")).toBe(2);
    expect(page.find("a[href^='/projects/']")?.text()).toBe("Website relaunch");
    expect(page.find("li:nth-child(2) a")?.text()).toBe("Billing & invoices");
    expect(page.find("li:first-child > span")?.text()).toBe("Active");
    expect(page.find("nav a + a")?.text()).toBe("Projects");
    expect(page.find("a.text-sm.font-medium")?.text()).toBe("Projects");
    expect(page.findAll("li:has(svg)")).toHaveLength(1);
    expect(page.find("h1 ~ p:not([hidden])")?.text()).toStartWith("Showing");
    expect(page.find("article")).toBeNull();
    expect(() => page.find("a::before")).toThrow(/pseudo-elements/);
    expect(() => page.find("a:hover")).toThrow(/:hover is not supported/);
    expect(() => page.find("a[href")).toThrow(/Cannot read the selector/);
  });

  test("roles and accessible names", () => {
    const list = page.getByRole("list", { name: "Projects" });
    const items = list.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.get("a").text())).toEqual([
      "Website relaunch",
      "Billing & invoices",
    ]);
    expect(page.getByRole("heading", { level: 1 }).text()).toBe("Projects");
    expect(page.getByRole("navigation", { name: "Main" }).findAllByRole("link")).toHaveLength(2);
    expect(page.getByRole("link", { name: "Edit Website relaunch" }).attr("href")).toBe(
      "/projects/1/edit",
    );
    expect(page.findAllByRole("link", { name: /^Edit / })).toHaveLength(1);
    expect(page.findByRole("banner")).toBeInstanceOf(HtmlElement);
    expect(page.findByRole("paragraph", { name: "Secret note" })).toBeNull();
  });

  test("text, innermost first", () => {
    expect(page.getByText("Active").tag).toBe("span");
    expect(page.findAllByText("Active")).toHaveLength(2);
    expect(page.findAllByText("Active", { selector: "p" })).toHaveLength(1);
    expect(page.getByText(/^Showing/).tag).toBe("p");
    expect(page.findByText("showing 1", { exact: false })?.tag).toBe("p");
    expect(page.findByText("Secret note")).toBeNull();
  });

  test("assertions chain", () => {
    page
      .assertTitle("Projects — Acme")
      .assertTitle(/^Projects/)
      .assertSeeText("Billing & invoices")
      .assertDontSeeText("Secret note")
      .assertPresent("main h1")
      .assertMissing("table")
      .assertCount("li", 2)
      .assertLink("Website relaunch", "/projects/1/edit")
      .assertLink("Billing & invoices", "/projects/2/edit")
      .assertLink(/^Billing/, /\/2\/edit$/);
  });
});

describe("fields and forms", () => {
  const page = parseHtml(FORM);

  test("finds a field by name, id or label", () => {
    expect(page.field("email").attr("type")).toBe("email");
    expect(page.field("field-email").attr("name")).toBe("email");
    expect(page.field("Email").attr("name")).toBe("email");
    expect(page.getByLabel("Send me the newsletter").attr("name")).toBe("newsletter");
    expect(page.getByRole("textbox", { name: "Name" }).value()).toBe('Ada "Countess" Lovelace');
    expect(page.getByRole("checkbox").name()).toBe("Send me the newsletter");
  });

  test("values, checked boxes and radios", () => {
    page
      .assertValue("name", 'Ada "Countess" Lovelace')
      .assertValue("email", "")
      .assertValue("bio", "Mathematician <and> writer")
      .assertValue("status", "active")
      .assertValue("plan", "pro")
      .assertChecked("newsletter")
      .assertChecked("plan", "pro")
      .assertNotChecked("plan", "free");
    expect(page.field("Status").value()).toBe("active");
    expect(page.find("option[selected]")?.isChecked()).toBe(true);
  });

  test("errors, read through aria-invalid and aria-describedby", () => {
    page
      .assertFieldError("email")
      .assertFieldError("email", "is required")
      .assertNoFieldError("name")
      // A hint is not an error: the field is not marked invalid.
      .assertNoFieldError("website");
    expect(() => page.assertFieldError("website")).toThrow(
      /Expected the field "website" to show an error, but it shows none/,
    );
    expect(() => page.assertFieldError("email", "must be valid")).toThrow(
      /it shows "The email field is required\."/,
    );
  });

  test("form actions, and their methods", () => {
    page
      .assertFormAction("/settings/profile")
      .assertFormAction("/settings/profile", "POST")
      .assertFormAction("/logout", "post")
      .assertFormAction(/^\/settings\//);
    expect(() => page.assertFormAction("/settings/profile", "GET")).toThrow(
      /Expected a form sending GET to "\/settings\/profile", but it sends POST/,
    );
    expect(() => page.assertFormAction("/nowhere")).toThrow(
      /Forms here:\n {2}POST \/settings\/profile \(Save\)\n {2}POST \/logout \(Sign out\)/,
    );
    parseHtml(`<form><button>Go</button></form>`).assertFormAction("", "GET");
  });

  test("a form's default button skips type=button and counts form= owners", () => {
    expect(page.form("/settings/profile").submitButton()?.text()).toBe("Save");
    expect(page.form("/logout").submitButton()?.text()).toBe("Sign out");
    const owned = parseHtml(
      `<form id="f" action="/a"><button form="other">Elsewhere</button><input></form><button form="f">Mine</button>`,
    );
    expect(owned.form("/a").submitButton()?.text()).toBe("Mine");
    expect(() => owned.get("input").submitButton()).toThrow(/reads a <form>/);
  });

  test("a scope narrows every query", () => {
    const logout = page.form("/logout");
    expect(logout.findAllByRole("button")).toHaveLength(1);
    expect(() => logout.field("email")).toThrow(/Expected a field named or labelled "email"/);
  });
});

describe("failures say what the page held", () => {
  const page = parseHtml(PAGE);

  test("a missing text quotes the page", () => {
    expect(() => page.assertSeeText("Dark mode")).toThrow(
      /Expected to see "Dark mode", but it is not here\.\n\nOn the page "Projects — Acme":\n {2}Home Projects Projects Website relaunch/,
    );
  });

  test("a missing role lists what has that role, or what roles there are", () => {
    expect(() => page.getByRole("link", { name: "Settings" })).toThrow(
      /With the role "link":\n {2}link "Home"\n {2}link "Projects"/,
    );
    expect(() => page.getByRole("table")).toThrow(/Roles here:\n {2}banner\n {2}navigation/);
  });

  test("a wrong link names where it goes, and a missing one lists the links", () => {
    expect(() => page.assertLink("Website relaunch", "/projects/9/edit")).toThrow(
      /but it points to "\/projects\/1\/edit"/,
    );
    expect(() => page.assertLink("Settings", "/settings")).toThrow(
      /Links here:\n {2}"Home" → \/\n {2}"Projects" → \/projects/,
    );
  });

  test("a wrong count shows the matches, without their classes", () => {
    expect(() => page.assertCount("nav a", 3)).toThrow(
      /Expected 3 elements to match "nav a", but 2 do\.\n\nMatched:\n {2}<a href="\/">Home<\/a>\n {2}<a href="\/projects">Projects<\/a>/,
    );
  });

  test("a missing field lists the fields", () => {
    expect(() => parseHtml(FORM).assertValue("phone", "1")).toThrow(
      /Fields here:\n {2}hidden name="_token" value "abc"\n {2}text name="name" labelled "Name"/,
    );
  });

  test("an element scope says which element it is", () => {
    expect(() => page.getByRole("list").assertSeeText("Dark mode")).toThrow(
      /Inside <ul aria-label="Projects">Website relaunch Active Billing/,
    );
  });
});

describe("where a page comes from", () => {
  test("a TestResponse parses its body once", async () => {
    const res = await TestResponse.of(
      new Response(PAGE, { headers: { "Content-Type": "text/html" } }),
    );
    expect(res.html()).toBe(res.html());
    expect(res.html()).toBeInstanceOf(HtmlDocument);
    res.html().assertTitle("Projects — Acme");
    expect(parseHtml(res)).toBe(res.html());
  });

  test("a redirect says it is not a page", async () => {
    const res = await TestResponse.of(
      new Response(null, { status: 302, headers: { Location: "/login" } }),
    );
    expect(() => res.html().assertSeeText("Projects")).toThrow(
      /Expected to see "Projects", but it is not here\.\nThe response is a 302 redirect to "\/login", not a page\./,
    );
  });

  test("anything with html(), as FlowTest has", () => {
    const rendered = { html: () => `<div data-flow-root><button>Save</button></div>` };
    parseHtml(rendered).getByRole("button", { name: "Save" });
  });
});

describe("edge cases a browser handles", () => {
  test("leaves a legacy reference alone in an attribute when = or a letter follows it", () => {
    const page = parseHtml(`<a href="/x?a=1&copy=2&reg=3&amp;b=4">&copy 2026</a>`);
    expect(page.get("a").attr("href")).toBe("/x?a=1&copy=2&reg=3&b=4");
    expect(page.get("a").text()).toBe("© 2026");
  });

  test("finds labels on a large form without rescanning it for every field", () => {
    const fields = Array.from(
      { length: 1500 },
      (_, i) => `<label for="f${i}">Field ${i}</label><input id="f${i}" name="f${i}">`,
    ).join("");
    const page = parseHtml(`<form>${fields}</form>`);
    const started = performance.now();
    expect(page.field("Field 1499").attr("name")).toBe("f1499");
    expect(page.getByRole("textbox", { name: "Field 750" }).attr("id")).toBe("f750");
    expect(performance.now() - started).toBeLessThan(500);
  });
});
