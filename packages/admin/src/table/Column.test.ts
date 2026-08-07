import { describe, it, expect } from "bun:test";
import { text } from "./Column.ts";

// ── camelCase key → DB column seam ───────────────────────────────────────────
// Regression: a camelCase column key was used verbatim as a SQL column for
// search/sort, 500-ing the request. `.column()` lets the cell key (an accessor)
// differ from the queried column.

describe("Column.getColumn / .column()", () => {
  it("defaults the query column to the cell key", () => {
    expect(text("name").getColumn()).toBe("name");
  });

  it("uses an explicit column override for query operations", () => {
    expect(text("authorName").column("author_name").getColumn()).toBe("author_name");
  });

  it("still reads the cell value by the key (accessor), not the column", () => {
    const col = text("authorName").column("author_name");
    expect(col.raw({ authorName: "Ada", author_name: "ignored" })).toBe("Ada");
  });
});

// ── Summaries still compute (guards the column-summary path) ──────────────────

describe("Column summaries", () => {
  it("sums a numeric column over rows", () => {
    const col = text("amount").sum("Total");
    const out = col.computeSummaries([{ amount: 10 }, { amount: 5 }, { amount: "7" }]);
    expect(out[0]).toEqual({ label: "Total", text: "22" });
  });

  it("counts rows", () => {
    const out = text("id")
      .count("Rows")
      .computeSummaries([{ id: 1 }, { id: 2 }]);
    expect(out[0]).toEqual({ label: "Rows", text: "2" });
  });
});
