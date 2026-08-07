import { describe, it, expect } from "bun:test";
import { FileUploads } from "./FileUploads.ts";

// The mixin only needs an @expose method on the prototype; exercise removeUpload's
// logic against a bare instance (no full Component needed).
const Mixed = FileUploads(class {} as never);

function inst(): any {
  return Object.create((Mixed as unknown as { prototype: object }).prototype);
}

describe("FileUploads.removeUpload", () => {
  it("clears a single-file property to null", () => {
    const c = inst();
    c.photo = { name: "a.png" };
    c.removeUpload("photo");
    expect(c.photo).toBe(null);
  });

  it("removes one item from a multiple-file array by index", () => {
    const c = inst();
    c.docs = ["a", "b", "c"];
    c.removeUpload("docs", 1);
    expect(c.docs).toEqual(["a", "c"]);
  });

  it("clears the whole array when no index is given", () => {
    const c = inst();
    c.docs = ["a", "b"];
    c.removeUpload("docs");
    expect(c.docs).toEqual([]);
  });
});
