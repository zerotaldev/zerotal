import { describe, it, expect } from "bun:test";
import { pluralize, singularize, snakeCase, camelCase, tableNameFor } from "./str.ts";

describe("pluralize", () => {
  it("applies regular rules", () => {
    expect(pluralize("user")).toBe("users");
    expect(pluralize("box")).toBe("boxes");
    expect(pluralize("class")).toBe("classes");
    expect(pluralize("category")).toBe("categories");
    expect(pluralize("day")).toBe("days"); // vowel + y
  });

  it("handles irregulars and uncountables", () => {
    expect(pluralize("person")).toBe("people");
    expect(pluralize("child")).toBe("children");
    expect(pluralize("equipment")).toBe("equipment");
  });

  it("inflects only the final snake_case segment", () => {
    expect(pluralize("blog_post")).toBe("blog_posts");
    expect(pluralize("audit_log")).toBe("audit_logs");
    expect(pluralize("user_category")).toBe("user_categories");
  });
});

describe("singularize", () => {
  it("reverses regular and irregular plurals", () => {
    expect(singularize("users")).toBe("user");
    expect(singularize("categories")).toBe("category");
    expect(singularize("boxes")).toBe("box");
    expect(singularize("people")).toBe("person");
  });
});

describe("snakeCase / camelCase", () => {
  it("round-trips", () => {
    expect(snakeCase("BlogPost")).toBe("blog_post");
    expect(snakeCase("userEmail")).toBe("user_email");
    expect(camelCase("blog_post")).toBe("blogPost");
    expect(camelCase("user-email")).toBe("userEmail");
  });
});

describe("tableNameFor", () => {
  it("derives convention table names from class names", () => {
    expect(tableNameFor("User")).toBe("users");
    expect(tableNameFor("BlogPost")).toBe("blog_posts");
    expect(tableNameFor("Category")).toBe("categories");
    expect(tableNameFor("Person")).toBe("people");
    expect(tableNameFor("AuditLog")).toBe("audit_logs");
  });
});
