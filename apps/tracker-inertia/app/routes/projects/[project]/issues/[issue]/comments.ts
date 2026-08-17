import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { broadcast } from "@zerotal/broadcasting";
import type { Project } from "@app/models/Project.ts";
import type { Issue } from "@app/models/Issue.ts";
import { Comment } from "@app/models/Comment.ts";
import { CommentPosted } from "@app/events/CommentPosted.ts";
import { StoreCommentRequest } from "@app/requests/StoreCommentRequest.ts";

export const middleware = [AuthMiddleware];

/**
 * POST /projects/:project/issues/:issue/comments — feature 7.
 *
 * Everyone signed in may comment, so there is no `Gate` here: the policy governs
 * editing an issue, not replying to one. The route still refuses guests through
 * `AuthMiddleware`, which is what makes `Auth.user()` safe to unwrap below.
 */
export async function POST(http: HttpContext): Promise<void> {
  const project = http.params.project as unknown as Project;
  const issue = http.params.issue as unknown as Issue;

  const input = await StoreCommentRequest.validate();
  const author = Auth.user()!;

  // `authorId` and `issueId` are not fillable, so neither can arrive from the
  // request body — they are set here, in code, which is the point of leaving
  // them off `fillable`. A comment that could name its own author is a comment
  // anyone could put in anyone's mouth.
  // Assigned rather than filled: `body` is the only rule this request carries and
  // it is already a `string`, so there is nothing for an `Issue`-style
  // `fillValidated` to narrow and no reason to add one.
  const comment = new Comment();
  comment.issueId = issue.id;
  comment.authorId = author.id;
  comment.body = input.body;
  await comment.save();

  const payload = {
    id: comment.id,
    body: comment.body,
    author: { name: author.name },
    createdAt: comment.createdAt?.toISOString?.() ?? null,
  };

  // `toOthers()` excludes the connection that sent this request, read from the
  // `X-Socket-ID` header the client attaches. Without it the author's own page
  // would receive the comment twice: once from the redirect below re-rendering
  // the thread, and once from the socket.
  broadcast(new CommentPosted(issue.id, payload)).toOthers();

  http.flash("success", __("Comment posted."));
  http.redirect(`/projects/${project.slug}/issues/${issue.id}`, 303);
}
