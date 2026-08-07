import { describe, it, expect } from "bun:test";
import { resolveMediaSrc } from "./media.ts";

// A stored value is not necessarily a URL, and rendering it as one is the bug
// that has now appeared in four separate places — the picker, the media grid,
// the table's image column and the view page's image entry.
//
// The failure is quiet and misleading: a browser reads `media/photo.jpg`
// relative to the page it is on, so a product table at `/admin/shop/products`
// fetches `/admin/shop/media/photo.jpg` and gets the panel's own 404. It looks
// like the file is missing when the file is fine.
//
// These run with no storage configured, which is deliberate: the resolver must
// degrade to `null` rather than throw into a render.

describe("resolveMediaSrc", () => {
  it("passes an absolute URL straight through", () => {
    expect(resolveMediaSrc("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
    expect(resolveMediaSrc("http://example.com/a.jpg")).toBe("http://example.com/a.jpg");
  });

  it("passes a protocol-relative URL through", () => {
    expect(resolveMediaSrc("//cdn.example.com/a.jpg")).toBe("//cdn.example.com/a.jpg");
  });

  it("passes a data URI through", () => {
    const uri = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveMediaSrc(uri)).toBe(uri);
  });

  it("passes a root-relative path through — the app already serves it", () => {
    expect(resolveMediaSrc("/uploads/a.jpg")).toBe("/uploads/a.jpg");
  });

  it("refuses to emit a bare disk path as a src", () => {
    // The whole point. Without storage there is no URL to give, and the answer
    // is `null` so the caller renders a placeholder — never the raw path.
    expect(resolveMediaSrc("media/a.jpg")).toBeNull();
  });

  it("treats an empty or non-string value as nothing to show", () => {
    expect(resolveMediaSrc("")).toBeNull();
    expect(resolveMediaSrc(null)).toBeNull();
    expect(resolveMediaSrc(undefined)).toBeNull();
    expect(resolveMediaSrc(42)).toBeNull();
  });

  it("does not throw when no storage is configured at all", () => {
    // It runs inside a render; an exception here takes the page down.
    expect(() => resolveMediaSrc("media/a.jpg", "nope")).not.toThrow();
  });
});
