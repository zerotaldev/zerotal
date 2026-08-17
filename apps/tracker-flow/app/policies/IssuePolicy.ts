import { Policy } from "zerotal/auth";
import type { User } from "@app/models/User.ts";
import type { Issue } from "@app/models/Issue.ts";

/**
 * Who may change an issue.
 *
 * The author, and nobody else — not even the project owner. That is a
 * deliberately strict rule for the cookbook, because a permissive one proves
 * nothing: the behaviour suite signs in as somebody who is *not* the author and
 * asserts the 403, and a rule that let the owner through would need a second
 * fixture to test the same thing.
 *
 * Shared byte-for-byte with the other two builds, so "who may edit this" cannot
 * drift between them — the answer is the framework's, not the render layer's.
 */
export class IssuePolicy extends Policy<Issue> {
  /** Anyone signed in can read an issue in a project they can reach. */
  view(user: User | null): boolean {
    return user != null;
  }

  update(user: User | null, issue: Issue): boolean {
    return user != null && user.id === issue.authorId;
  }

  delete(user: User | null, issue: Issue): boolean {
    return user != null && user.id === issue.authorId;
  }
}
