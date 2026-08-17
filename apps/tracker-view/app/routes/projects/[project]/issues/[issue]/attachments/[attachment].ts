import type { HttpContext } from "zerotal";
import { Storage } from "zerotal/storage";
import { AuthMiddleware } from "zerotal/auth";
import type { Issue } from "@app/models/Issue.ts";
import type { Attachment } from "@app/models/Attachment.ts";

export const middleware = [AuthMiddleware];

/**
 * GET /projects/:project/issues/:issue/attachments/:attachment — the bytes back.
 *
 * A route rather than a URL on the disk, because the default disk is private and
 * should stay that way: an attachment is readable by whoever may read the issue,
 * and a storage URL cannot express that.
 *
 * The ownership check is the point. Route binding resolves `:attachment` by
 * primary key alone, so without this line `/issues/1/attachments/999` would
 * happily serve an attachment belonging to a different issue — the id in the
 * path is not evidence of anything until it has been checked against the issue
 * in the same path.
 */
export const GET = async (http: HttpContext): Promise<Response> => {
  const issue = http.params.issue as unknown as Issue;
  const attachment = http.params.attachment as unknown as Attachment;

  if (attachment.issueId !== issue.id) {
    return new Response("Not found", { status: 404 });
  }

  // `getBuffer` returns null when the key is gone. A row whose bytes have been
  // deleted underneath it is a 404 and not a 500: the request is well-formed and
  // the answer is that there is nothing there.
  const bytes = await Storage.disk().getBuffer(attachment.path);
  if (bytes === null) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      // The stored MIME, which was sniffed from the bytes at upload — not the
      // type the client claimed.
      "Content-Type": attachment.mime,
      // `attachment`, so a file that happens to be renderable is still saved
      // rather than executed in this origin. The reader's own filename comes
      // back here, quoted, having never been used as a path.
      "Content-Disposition": `attachment; filename="${attachment.originalName.replace(/"/g, "")}"`,
      "Content-Length": String(attachment.size),
      // Private: it is behind auth, so no shared cache may keep a copy.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
};
