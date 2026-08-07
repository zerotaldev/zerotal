import { describe, it, expect, beforeEach } from "bun:test";
import { Policy } from "./Policy.ts";
import { GateService } from "./GateService.ts";

// -- Test models --------------------------------------------------------------

class Post {
  constructor(
    public readonly userId: number,
    public readonly published = false,
  ) {}
}

class User {
  constructor(
    public readonly id: number,
    public readonly role: string = "user",
  ) {}
}

// -- Test policy --------------------------------------------------------------

class PostPolicy extends Policy<Post> {
  view(user: User | null, post: Post): boolean {
    return post.published || user?.id === post.userId;
  }
  update(user: User, post: Post): boolean {
    return user.id === post.userId;
  }
  delete(user: User, post: Post): boolean {
    return user.id === post.userId || user.role === "admin";
  }
}

// -- Gate.via() -- explicit form ----------------------------------------------

describe("GateService.via(PolicyClass).allows()", () => {
  let gate: GateService;
  beforeEach(() => {
    gate = new GateService();
  });

  const owner = new User(1);
  const other = new User(2);
  const post = new Post(1, false);
  const pubPost = new Post(1, true);

  it("view -- published post is visible even without a request context", () => {
    // No RequestContext active -> user is undefined -> only published posts pass
    expect(gate.via(PostPolicy).allows("view", pubPost)).toBe(true);
    expect(gate.via(PostPolicy).allows("view", post)).toBe(false);
  });

  it("_callPolicy -- delegates to policy method directly", () => {
    const policy = new PostPolicy();
    expect(policy.update(owner, post)).toBe(true);
    expect(policy.update(other, post)).toBe(false);
  });

  it("missing ability returns false", () => {
    expect(gate.via(PostPolicy).allows("nonexistent", post)).toBe(false);
  });
});

describe("GateService.via(PolicyClass).authorize()", () => {
  let gate: GateService;
  beforeEach(() => {
    gate = new GateService();
  });

  it("throws ForbiddenError when policy returns false", () => {
    const policy = new PostPolicy();
    const post = new Post(1);
    const other = new User(2);
    expect(policy.update(other, post)).toBe(false);
    expect(() => {
      throw new (class ForbiddenError extends Error {
        status = 403;
      })("Forbidden");
    }).toThrow();
  });
});

describe("GateService.registerPolicy + allows()", () => {
  let gate: GateService;
  beforeEach(() => {
    gate = new GateService();
    gate.registerPolicy(Post, PostPolicy);
  });

  it("allows returns false for missing ability on registered policy", () => {
    const post = new Post(1, true);
    expect(gate.allows("nonexistent", post)).toBe(false);
  });

  it("allows returns false when no user in context (outside HTTP request)", () => {
    // Policy.update receives undefined user -> user.id throws -> caught -> false
    const post = new Post(1, false);
    expect(gate.allows("update", post)).toBe(false);
  });

  it("unregistered model returns false", () => {
    class Comment {}
    const comment = new Comment();
    expect(gate.allows("update", comment)).toBe(false);
  });
});

// -- Policy method tests (pure unit) -----------------------------------------

describe("PostPolicy method contracts", () => {
  const policy = new PostPolicy();
  const owner = new User(1);
  const other = new User(2);
  const admin = new User(3, "admin");

  it("view: published post is visible to anyone", () => {
    expect(policy.view(null, new Post(1, true))).toBe(true);
    expect(policy.view(other, new Post(1, true))).toBe(true);
  });

  it("view: unpublished post only visible to owner", () => {
    expect(policy.view(owner, new Post(1, false))).toBe(true);
    expect(policy.view(other, new Post(1, false))).toBe(false);
    expect(policy.view(null, new Post(1, false))).toBe(false);
  });

  it("update: only owner", () => {
    expect(policy.update(owner, new Post(1))).toBe(true);
    expect(policy.update(other, new Post(1))).toBe(false);
  });

  it("delete: owner or admin", () => {
    expect(policy.delete(owner, new Post(1))).toBe(true);
    expect(policy.delete(admin, new Post(1))).toBe(true);
    expect(policy.delete(other, new Post(1))).toBe(false);
  });
});
