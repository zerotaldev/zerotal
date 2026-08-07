import { describe, it, expect } from "bun:test";
import { Blueprint } from "./Blueprint.ts";

describe("Blueprint dropForeign / fulltext / change", () => {
  it("dropForeign emits dialect-specific SQL", () => {
    const mk = () => {
      const b = new Blueprint();
      b.dropForeign(["user_id"]);
      return b;
    };
    expect(
      mk()
        .toAlterSQL("posts", "mysql")
        .some((s) => /DROP FOREIGN KEY posts_user_id_foreign/.test(s)),
    ).toBe(true);
    expect(
      mk()
        .toAlterSQL("posts", "postgres")
        .some((s) => /DROP CONSTRAINT posts_user_id_foreign/.test(s)),
    ).toBe(true);
    // SQLite emits nothing for dropForeign
    expect(
      mk()
        .toAlterSQL("posts", "sqlite")
        .some((s) => /FOREIGN/.test(s)),
    ).toBe(false);
  });
  it("dropForeign accepts an explicit constraint name", () => {
    const b = new Blueprint();
    b.dropForeign("fk_custom");
    expect(b.toAlterSQL("posts", "mysql").some((s) => /DROP FOREIGN KEY fk_custom/.test(s))).toBe(
      true,
    );
  });
  it("fulltext + spatialIndex create index statements", () => {
    const b = new Blueprint();
    b.string("title");
    b.string("body");
    b.fulltext(["title", "body"]);
    const sql = b.toCreateSQL("posts");
    expect(
      sql.some((s) => /CREATE INDEX posts_title_body_fulltext ON posts \(title, body\)/.test(s)),
    ).toBe(true);
  });
  it("column change() marks an alter", () => {
    const b = new Blueprint();
    b.string("email").nullable().change();
    const sql = b.toAlterSQL("users", "mysql");
    expect(sql.some((s) => /MODIFY COLUMN email/.test(s))).toBe(true);
  });
});
