/**
 * Tests for model decorators (standard TC39 decorators): @table, @column, and the
 * relation decorators.
 *
 * On Bun 1.3.x, field decorators can only capture their name+config synchronously in the
 * decorator BODY; the `@table` class decorator drains those queued registrations into the
 * concrete class at definition time. So every test class here carries `@table(...)` — that
 * is what makes its columns/relations register. The readers `columnsFor` / `relationsFor`
 * then walk the prototype chain.
 */
import { describe, it, expect } from "bun:test";

import { table } from "./table.ts";
import { column, installReactiveAccessors } from "./column.ts";
import { columnsFor, relationsFor } from "./_metadata.ts";
import { hasMany } from "./hasMany.ts";
import { hasOne } from "./hasOne.ts";
import { belongsTo } from "./belongsTo.ts";
import { manyToMany } from "./manyToMany.ts";
import { morphMany } from "./morphMany.ts";
import { morphOne } from "./morphOne.ts";
import { morphTo } from "./morphTo.ts";
import { morphToMany } from "./morphToMany.ts";
import { morphedByMany } from "./morphedByMany.ts";
import { hasManyThrough } from "./hasManyThrough.ts";
import { hasOneThrough } from "./hasOneThrough.ts";
class Related {}

/** Relation metadata registered for a class field, loosely typed. */
function relMeta(Cls: Function, field: string): Record<string, unknown> {
  return relationsFor(Cls).get(field) as unknown as Record<string, unknown>;
}

// ── @table ────────────────────────────────────────────────────────────────────

describe("@table decorator", () => {
  it("sets static table, timestamps, softDeletes, primaryKey with defaults", () => {
    class Users {}
    table("users")(Users);
    const U = Users as unknown as Record<string, unknown>;
    expect(U["table"]).toBe("users");
  });

  it("builder methods configure timestamps / primaryKey", () => {
    class Posts {}
    table("posts").withTimestamps().primaryKey("uuid")(Posts);
    const P = Posts as unknown as Record<string, unknown>;
    expect(P["table"]).toBe("posts");
    expect(P["timestamps"]).toBe(true);
    expect(P["primaryKey"]).toBe("uuid");
  });
});

// ── @column ─────────────────────────────────────────────────────────────────────

describe("@column decorator", () => {
  it("registers shorthand types and casts", () => {
    @table("m_cols")
    class M {
      @column() name!: string;
      @column("integer") age!: number;
      @column("float") score!: number;
      @column("boolean") active!: boolean;
      @column("datetime") createdAt!: unknown;
      @column("date") dob!: unknown;
      @column("json") meta!: unknown;
      @column("array") tags!: unknown;
      @column("text") body!: string;
      @column("number") amount!: number;
      @column("decimal:2") price!: string;
      @column("immutable_datetime") frozenAt!: unknown;
    }
    const cols = columnsFor(M)!;
    expect(cols.get("name")?.type).toBe("string");
    expect(cols.get("age")?.type).toBe("number");
    expect(cols.get("age")?.cast).toBe("integer");
    expect(cols.get("score")?.cast).toBe("float");
    expect(cols.get("active")?.cast).toBe("boolean");
    expect(cols.get("createdAt")?.cast).toBe("datetime");
    expect(cols.get("dob")?.cast).toBe("date");
    expect(cols.get("meta")?.cast).toBe("json");
    expect(cols.get("tags")?.cast).toBe("array");
    expect(cols.get("body")?.type).toBe("string");
    expect(cols.get("amount")?.type).toBe("number");
    expect(cols.get("price")?.cast).toBe("decimal:2");
    expect(cols.get("frozenAt")?.cast).toBe("immutable_datetime");
  });

  it("records casts on the static ctor.casts map", () => {
    @table("m2_casts")
    class M2 {
      @column("integer") qty!: number;
      @column("boolean") isAdmin!: boolean;
    }
    const casts = (M2 as unknown as { casts: Record<string, unknown> }).casts;
    expect(casts["qty"]).toBe("integer");
    expect(casts["isAdmin"]).toBe("boolean");
  });

  it("accepts a full options object", () => {
    @table("m3_opts")
    class M3 {
      @column({ type: "string", nullable: true }) bio!: string | null;
    }
    const opt = columnsFor(M3)!.get("bio")!;
    expect(opt.type).toBe("string");
    expect(opt.nullable).toBe(true);
  });

  it("json column with reactiveCasts installs a reactive accessor", () => {
    @table("m4_reactive")
    class M4 {
      static reactiveCasts = true;
      @column("json") data!: Record<string, unknown>;
    }
    const inst = new M4();
    installReactiveAccessors(inst); // models call this from fill()/hydrate
    const desc = Object.getOwnPropertyDescriptor(inst, "data");
    expect(typeof desc?.get).toBe("function");
  });
});

// ── Relation decorators ─────────────────────────────────────────────────────────

describe("relation decorators", () => {
  it("hasMany registers metadata", () => {
    @table("rel_o")
    class O {
      @hasMany(() => Related, { foreignKey: "o_id" }) items!: unknown;
    }
    const m = relMeta(O, "items");
    expect(m["type"]).toBe("hasMany");
    expect(m["foreignKey"]).toBe("o_id");
    expect(m["localKey"]).toBe("id");
  });

  it("hasOne honours an explicit localKey", () => {
    @table("rel_u")
    class U {
      @hasOne(() => Related, { foreignKey: "u_id", localKey: "uuid" }) profile!: unknown;
    }
    const m = relMeta(U, "profile");
    expect(m["type"]).toBe("hasOne");
    expect(m["foreignKey"]).toBe("u_id");
    expect(m["localKey"]).toBe("uuid");
  });

  it("belongsTo registers metadata", () => {
    @table("rel_b")
    class B {
      @belongsTo(() => Related, { foreignKey: "author_id" }) author!: unknown;
    }
    const m = relMeta(B, "author");
    expect(m["type"]).toBe("belongsTo");
    expect(m["foreignKey"]).toBe("author_id");
  });

  it("manyToMany registers pivot metadata", () => {
    @table("rel_p")
    class P {
      @manyToMany(() => Related, {
        pivotTable: "pt",
        pivotForeignKey: "p_id",
        pivotRelatedKey: "t_id",
      })
      tags!: unknown;
    }
    const m = relMeta(P, "tags");
    expect(m["type"]).toBe("manyToMany");
    expect(m["pivotTable"]).toBe("pt");
    expect(m["pivotForeignKey"]).toBe("p_id");
    expect(m["pivotRelatedKey"]).toBe("t_id");
  });

  it("morphMany derives _type/_id columns from morphName", () => {
    @table("rel_v")
    class V {
      @morphMany(() => Related, { morphName: "commentable" }) comments!: unknown;
    }
    const m = relMeta(V, "comments");
    expect(m["type"]).toBe("morphMany");
    expect(m["foreignKey"]).toBe("commentable_id");
    expect(m["morphTypeColumn"]).toBe("commentable_type");
  });

  it("morphOne derives columns from morphName", () => {
    @table("rel_pr")
    class Pr {
      @morphOne(() => Related, { morphName: "imageable" }) image!: unknown;
    }
    const m = relMeta(Pr, "image");
    expect(m["type"]).toBe("morphOne");
    expect(m["foreignKey"]).toBe("imageable_id");
    expect(m["morphTypeColumn"]).toBe("imageable_type");
  });

  it("morphTo derives snake_case columns from the property name", () => {
    @table("rel_c")
    class C {
      @morphTo({ morphMap: { post: () => Related } }) commentable!: unknown;
    }
    const m = relMeta(C, "commentable");
    expect(m["type"]).toBe("morphTo");
    expect(m["foreignKey"]).toBe("commentable_id");
    expect(m["morphTypeColumn"]).toBe("commentable_type");
  });

  it("morphToMany sets pivotMorphValue to the owning class name", () => {
    @table("posts")
    class Post {
      @morphToMany(() => Related, { morphName: "taggable", relatedPivotKey: "tag_id" })
      tags!: unknown;
    }
    const m = relMeta(Post, "tags");
    expect(m["type"]).toBe("morphToMany");
    expect(m["pivotTable"]).toBe("taggables");
    expect(m["pivotMorphValue"]).toBe("Post");
    expect(m["pivotRelatedKey"]).toBe("tag_id");
  });

  it("morphedByMany registers inverse pivot metadata", () => {
    @table("tags")
    class Tag {
      @morphedByMany(() => Related, { morphName: "taggable", parentPivotKey: "tag_id" })
      posts!: unknown;
    }
    const m = relMeta(Tag, "posts");
    expect(m["type"]).toBe("morphedByMany");
    expect(m["pivotForeignKey"]).toBe("tag_id");
    expect(m["pivotRelatedKey"]).toBe("taggable_id");
  });

  it("hasManyThrough registers through metadata", () => {
    @table("countries")
    class Country {
      @hasManyThrough(() => Related, () => class {}, {
        firstKey: "country_id",
        secondKey: "user_id",
      })
      posts!: unknown;
    }
    const m = relMeta(Country, "posts");
    expect(m["type"]).toBe("hasManyThrough");
    expect(m["firstKey"]).toBe("country_id");
    expect(m["secondKey"]).toBe("user_id");
  });

  it("hasOneThrough registers through metadata", () => {
    @table("countries_one")
    class Ctry {
      @hasOneThrough(() => Related, () => class {}, {
        firstKey: "country_id",
        secondKey: "user_id",
      })
      latest!: unknown;
    }
    const m = relMeta(Ctry, "latest");
    expect(m["type"]).toBe("hasOneThrough");
    expect(m["firstKey"]).toBe("country_id");
  });

  it("registers the relation once at definition time", () => {
    @table("rel_x")
    class X {
      @hasMany(() => Related, { foreignKey: "a_id" }) items!: unknown;
    }
    expect(relMeta(X, "items")["foreignKey"]).toBe("a_id");
  });
});
