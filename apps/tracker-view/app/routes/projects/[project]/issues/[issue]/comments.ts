import type { HttpContext } from "zerotal";
import { Auth, AuthMiddleware } from "zerotal/auth";
import { broadcast } from "@zerotal/broadcasting";
import type { Project } from "@app/models/Project.ts";
import type { Issue } from "@app/models/Issue.ts";
import { Comment } from "@app/models/Comment.ts";
import { CommentPosted } from "@app/events/CommentPosted.ts";
import { StoreCommentRequest } from "@app/requests/StoreCommentRequest.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/**
 * POST /projects/:project/issues/:issue/comments — feature 7.
 *
 * Everyone signed in may comment, so there is no `Gate` here: the policy governs
 * editing an issue, not replying to one. The route still refuses guests through
 * `AuthMiddleware`, which is what makes `Auth.user()` safe to unwrap below.
 *
 * The broadcast still fires, and it is not decorative even though this build has
 * no socket to receive it: the Inertia build's open thread is listening on the
 * same channel, and a comment posted from here appears there live. Dropping it
 * would make the two builds disagree about what the *server* does.
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
  const comment = new Comment();
  comment.issueId = issue.id;
  comment.authorId = author.id;
  comment.body = input.body;
  await comment.save();

  broadcast(
    new CommentPosted(issue.id, {
      id: comment.id,
      body: comment.body,
      author: { name: author.name },
      createdAt: comment.createdAt?.toISOString?.() ?? null,
    }),
  ).toOthers();

  http.flash("success", __("Comment posted."));
  http.redirect(
    route("projects.issues.show", { project: project.slug, issue: String(issue.id) }),
    303,
  );
}
