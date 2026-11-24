import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformFlowFile, validateFlowFile, type BlockerReport } from "./transform.ts";

/**
 * An app shares its page plumbing through a class of its own — `class LoginPage extends Page`,
 * with `Page extends Component` in a module beside the pages. Only `render()` is compiled, so the
 * page compiles exactly as if it extended `Component` itself.
 */

let root: string;
const page = (name: string, base: string, from: string, body = "<p>{this.title}</p>") =>
  `/** @jsxImportSource @zerotal/flow */
import { ${base} } from "${from}";
export class ${name} extends ${base} {
  override async render() { return (${body}); }
}
`;

function compile(
  file: string,
  source: string,
): { out: string | null; blocker: string | undefined } {
  const report: BlockerReport = {};
  const result = transformFlowFile(source, join(root, file), { report });
  return { out: result?.renderBody ?? null, blocker: report.blocker?.reason };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "zt-flow-base-"));
  mkdirSync(join(root, "lib"));
  mkdirSync(join(root, "pages", "auth"), { recursive: true });
  writeFileSync(
    join(root, "lib", "page.ts"),
    `import { Component, locked } from "@zerotal/flow";
export class Page extends Component {
  @locked title = "";
}
`,
  );
  writeFileSync(
    join(root, "lib", "form-page.ts"),
    `import { Page } from "./page";
export class FormPage extends Page {}
`,
  );
  writeFileSync(join(root, "lib", "plain.ts"), `export class Plain {}\n`);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("a page that extends a base class of the app's own", () => {
  it("compiles, from any depth of the pages folder", () => {
    expect(
      compile("pages/auth/login.tsx", page("LoginPage", "Page", "../../lib/page")).out,
    ).toContain("<p>");
  });

  it("follows a base class that extends another", () => {
    expect(
      compile("pages/form.tsx", page("FormPage2", "FormPage", "../lib/form-page")).out,
    ).not.toBeNull();
  });

  it("counts the base class's @locked fields as the page's own", () => {
    // `{this.title}` names a field the page itself never declares.
    expect(() =>
      validateFlowFile(page("LoginPage", "Page", "../lib/page"), join(root, "pages/x.tsx")),
    ).not.toThrow();
    expect(compile("pages/x.tsx", page("LoginPage", "Page", "../lib/page")).out).toContain(
      "this.title",
    );
  });

  it("says why when the base class is not a Component", () => {
    const { out, blocker } = compile("pages/p.tsx", page("P", "Plain", "../lib/plain"));
    expect(out).toBeNull();
    expect(blocker).toBe("`P` does not extend Component");
  });

  it("says why when the base class cannot be found", () => {
    expect(compile("pages/p.tsx", page("P", "Gone", "../lib/gone")).blocker).toBe(
      "`P` does not extend Component",
    );
  });
});
