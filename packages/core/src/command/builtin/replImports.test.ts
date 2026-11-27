import { describe, expect, it } from "bun:test";
import { _rewriteImportDeclaration as rewrite } from "./replImports.ts";

describe("rewriting an import declaration typed at the REPL", () => {
  it.each([
    ['import "reflect-metadata"', 'await import("reflect-metadata")'],
    [
      'import User from "./app/models/User"',
      'const { default: User } = await import("./app/models/User")',
    ],
    ['import * as path from "node:path"', 'const path = await import("node:path")'],
    [
      'import { TwoFactor } from "zerotal/auth";',
      'const { TwoFactor } = await import("zerotal/auth")',
    ],
    ["import { a as b, c } from 'm'", "const { a: b, c } = await import('m')"],
    ['import X, { y } from "m"', 'const { default: X, y } = await import("m")'],
    ['import { type T, v } from "m"', 'const { v } = await import("m")'],
    ['import type { T } from "m"', "undefined"],
  ])("%s", (input, expected) => {
    expect(rewrite(input)).toBe(expected);
  });

  it("leaves everything else alone", () => {
    for (const line of ['await import("m")', 'import("m")', "importantValue", "1 + 1"]) {
      expect(rewrite(line)).toBe(line);
    }
  });
});
