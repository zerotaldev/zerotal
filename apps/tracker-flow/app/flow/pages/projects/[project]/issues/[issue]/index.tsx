import {
  Component,
  FileUpload,
  FileUploads,
  Head,
  Link,
  expose,
  locked,
  on,
  transient,
} from "@zerotal/flow";
import type { HtmlNode, TemporaryUploadedFile } from "@zerotal/flow";
import { Auth, AuthMiddleware, Gate } from "zerotal/auth";
import { broadcast } from "@zerotal/broadcasting";
import { Storage } from "zerotal/storage";
import type { Project } from "@app/models/Project.ts";
import { Issue } from "@app/models/Issue.ts";
import { Comment } from "@app/models/Comment.ts";
import { Attachment } from "@app/models/Attachment.ts";
import { CommentPosted } from "@app/events/CommentPosted.ts";
import { StoreCommentRequest } from "@app/requests/StoreCommentRequest.ts";
import {
  ATTACHMENT_MAX_KB,
  ATTACHMENT_MIMES,
} from "@app/requests/StoreAttachmentRequest.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../../../layouts/app.tsx";
import {
  BADGE,
  CARD,
  ERROR,
  LABEL_TONE,
  PRIMARY,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SECONDARY,
  STATUS_LABEL,
  STATUS_TONE,
  TEXTAREA,
  fileSize,
} from "../../../../../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/** One message on the thread, as the page draws it. */
interface CommentRow {
  id: number;
  body: string;
  author: { name: string } | null;
  createdAt: string | null;
}

/** One file on the issue, as the page draws it. */
interface AttachmentRow {
  id: number;
  originalName: string;
  size: number;
  uploader: string | null;
}

/**
 * GET /projects/:project/issues/:issue — one issue, its thread and its files.
 *
 * The thread is `@locked` state loaded in `onMount()` and *appended to* by the
 * post action, rather than re-queried on every render. That is the difference
 * this build is for: posting a comment does not reload the page, does not
 * re-run the issue query, and does not lose what somebody else was typing in
 * the box below — it appends one row to an array and Flow patches one `<li>`
 * into the DOM.
 *
 * The other reader's comment arrives the same way, over the private channel this
 * page subscribes to — see `onCommentPosted`. Building that turned up a
 * framework bug: `@on` read its channel name off the *class*, so the syntax the
 * guide showed (`"echo-private:issues.${this.issueId},CommentPosted"`) reached
 * the browser with the placeholder intact and subscribed to a channel nobody
 * broadcasts to — silently, with no error and no events. `@on` now also takes a
 * resolver, like `@presence` and `@shared` next to it.
 */
export class IssueDetailPage extends Component.using(FileUploads) {
  static layout = AppLayout;
  static title = "Issue";

  /** `:project` and `:issue` — the records, already resolved by the router. */
  @locked project!: Project;
  @locked issue!: Issue;

  @locked author = "";
  @locked assignee = "";
  @locked labels: { name: string; colour: string }[] = [];
  @locked canUpdate = false;

  @locked comments: CommentRow[] = [];
  @locked attachments: AttachmentRow[] = [];

  /** The comment being written. Two-way bound to the textarea. */
  @expose body = "";

  /** The chosen file, before it is stored. Bound to `<FileUpload>`. */
  @expose file: TemporaryUploadedFile | null = null;

  /** Cleared on every round-trip, which is exactly what an error message wants. */
  @transient uploadError = "";

  override async onMount(): Promise<void> {
    // Re-queried with its relations rather than using the bound instance: route
    // binding resolves the row, not the graph, and reading `issue.author.name`
    // off an unloaded relation is how a detail page becomes four queries.
    const issue = await Issue.query()
      .where("id", this.issue.id)
      .with("author")
      .with("assignee")
      .with("labels")
      .firstOrFail();

    this.author = issue.author?.name ?? "—";
    this.assignee = issue.assignee?.name ?? "";
    this.labels = (issue.labels ?? []).map((label) => ({
      name: label.name,
      colour: label.colour,
    }));
    this.canUpdate = Gate.allows("update", issue);

    await this.loadThread();
    await this.loadAttachments();
  }

  private async loadThread(): Promise<void> {
    const comments = await Comment.query()
      .where("issue_id", this.issue.id)
      .with("author")
      .orderBy("created_at", "asc")
      .get();

    this.comments = comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.author ? { name: comment.author.name } : null,
      createdAt: comment.createdAt?.toISOString?.() ?? null,
    }));
  }

  private async loadAttachments(): Promise<void> {
    const attachments = await Attachment.query()
      .where("issue_id", this.issue.id)
      .with("uploader")
      .orderBy("created_at", "asc")
      .get();

    this.attachments = attachments.map((attachment) => ({
      id: attachment.id,
      originalName: attachment.originalName,
      size: attachment.size,
      uploader: attachment.uploader?.name ?? null,
    }));
  }

  /**
   * Post a comment — feature 7, over the socket.
   *
   * The rule is **not** restated here. `StoreCommentRequest.rules()` is the same
   * object the other two builds validate against, and calling it for the one
   * field it defines is what keeps "one set of rules, three render layers" true
   * rather than merely claimed: change `min(1)` there and this action changes
   * with it. `FormRequest.validate()` itself is not usable from a Flow action —
   * it reads a request body, and there is no body in a socket frame — but the
   * rules it is built from are just a builder callback, and that travels.
   */
  @expose async postComment(): Promise<void> {
    await this.validate({ body: (r) => new StoreCommentRequest().rules(r).body });

    const comment = new Comment();
    comment.fill({ body: this.body });
    comment.issueId = this.issue.id;
    comment.authorId = Auth.user()!.id;
    await comment.save();

    const row: CommentRow = {
      id: comment.id,
      body: comment.body,
      author: { name: Auth.user()!.name },
      createdAt: comment.createdAt?.toISOString?.() ?? null,
    };

    // Appended rather than re-queried: the row that was just written is the row
    // that is being added, and a second SELECT to learn what we already know is
    // a query per comment on a page that exists to be fast.
    this.comments = [...this.comments, row];
    this.body = "";

    // Broadcast even though this page does not subscribe. The event is the
    // app's contract, not this page's — the Inertia build listens on the same
    // channel, and a comment posted here should reach a reader over there.
    //
    // Plain, not `.toOthers()`. The view and Inertia builds exclude the poster
    // because their own browser is on that Echo channel and would otherwise
    // render the comment twice. This page is not on it — the socket it holds is
    // Flow's, not Echo's — so there is nobody here to exclude, and asking to
    // exclude "this connection" would name a socket the broadcaster has never
    // heard of.
    broadcast(new CommentPosted(this.issue.id, row));
  }

  /**
   * Somebody else's comment, arriving while this page is open — feature 7's other half.
   *
   * The channel is a resolver rather than a string because it names *this*
   * issue. The decorator's argument is read off the class, so a template literal
   * in a plain string is not interpolated — it would subscribe to a channel
   * whose name contains `${this.issue.id}` and receive nothing, with no error to
   * say so. `(self) => …` is resolved against the instance when the snapshot is
   * built, which is late enough for `onMount()` to have run.
   *
   * `issues.{id}` and not a shared `issues` channel with a filter in this
   * method: the filter would run *after* the broadcast had already been
   * delivered to every subscriber's browser, so every signed-in reader would
   * receive every issue's comment bodies and discard them. The channel is the
   * access control; `app/channels.ts` authorises it.
   *
   * The id check below is not the authorisation — it is de-duplication. The
   * poster appends optimistically in `postComment`, and if their own broadcast
   * ever reaches them the row is already here.
   */
  @on((self) => `echo-private:issues.${(self as IssueDetailPage).issue.id},CommentPosted`)
  async onCommentPosted(payload: { comment: CommentRow }): Promise<void> {
    if (this.comments.some((c) => c.id === payload.comment.id)) return;
    this.comments = [...this.comments, payload.comment];
  }

  /**
   * Attach a file — feature 8.
   *
   * The bytes reached `/__flow/upload` over HTTP before this action ran, so what
   * arrives here is a signed reference to a file already on the temporary disk,
   * not a multipart body. `store()` moves it to permanent storage under a
   * generated name; the reader's own filename is kept as a column and never used
   * as a path.
   *
   * The limits are imported from `StoreAttachmentRequest` rather than retyped,
   * so the hint the reader is shown, the check that rejects them, and the rule
   * the other two builds enforce are one list. They are checked here in the
   * action because `<FileUpload accept maxSize>` is a *client* courtesy: it
   * filters the picker, and a socket frame can carry a reference to anything.
   */
  @expose async attachFile(): Promise<void> {
    this.uploadError = "";
    if (!this.file) return;

    const extension = this.file.extension();
    if (!ATTACHMENT_MIMES.includes(extension)) {
      this.uploadError = __("That file type is not accepted.");
      return;
    }
    if (this.file.size > ATTACHMENT_MAX_KB * 1024) {
      this.uploadError = __("That file is too large.");
      return;
    }

    const path = await this.file.store("attachments");

    const attachment = new Attachment();
    attachment.issueId = this.issue.id;
    attachment.uploaderId = Auth.user()!.id;
    attachment.path = path;
    attachment.originalName = this.file.name;
    attachment.mime = this.file.mime;
    attachment.size = this.file.size;
    await attachment.save();

    this.file = null;
    await this.loadAttachments();
    this.flash(__("File attached."));
  }

  @expose async removeAttachment(id: number): Promise<void> {
    const attachment = await Attachment.query()
      .where("id", id)
      .where("issue_id", this.issue.id)
      .first();

    // The `issue_id` clause above is the check, not a filter: without it, an id
    // typed into a socket frame would delete somebody else's file. `null` here
    // means "not on this issue", and the answer to that is nothing at all.
    if (!attachment) return;
    if (!Gate.allows("update", this.issue)) return;

    await Storage.disk().delete(attachment.path);
    await attachment.delete();
    await this.loadAttachments();
    this.flash(__("Attachment removed."));
  }

  async render(): Promise<HtmlNode> {
    const base = `/projects/${this.project.slug}/issues/${this.issue.id}`;

    return (
      <div class="max-w-3xl space-y-6">
        <Head>
          <title>{`${this.issue.title} — Tracker`}</title>
        </Head>

        <nav aria-label={__("Breadcrumb")} class="text-xs text-muted-foreground">
          <Link href="/projects" hover class="hover:text-foreground">
            {__("Projects")}
          </Link>
          <span aria-hidden="true" class="px-1.5">
            /
          </span>
          <Link href={`/projects/${this.project.slug}`} hover class="hover:text-foreground">
            {this.project.name}
          </Link>
        </nav>

        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold tracking-tight">{this.issue.title}</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {__("Opened by {author}", {
                author: this.author,
              })}
            </p>
          </div>
          {this.canUpdate ? (
            <Link href={`${base}/edit`} hover class={SECONDARY}>
              {__("Edit")}
            </Link>
          ) : null}
        </div>

        <div class={`${CARD} p-5`}>
          <div class="flex flex-wrap items-center gap-2">
            <span class={`${BADGE} ${STATUS_TONE[this.issue.status] ?? ""}`}>
              {__(STATUS_LABEL[this.issue.status] ?? this.issue.status)}
            </span>
            <span class={`${BADGE} ${PRIORITY_TONE[this.issue.priority] ?? ""}`}>
              {__(PRIORITY_LABEL[this.issue.priority] ?? this.issue.priority)}
            </span>
            {this.labels.map((label) => (
              <span key={label.name} class={`${BADGE} ${LABEL_TONE[label.colour] ?? ""}`}>
                {label.name}
              </span>
            ))}
          </div>

          <dl class="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt class="text-xs text-muted-foreground">{__("Assignee")}</dt>
              <dd class="mt-1 text-sm">{this.assignee || __("Unassigned")}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted-foreground">{__("Status")}</dt>
              <dd class="mt-1 text-sm">
                {__(STATUS_LABEL[this.issue.status] ?? this.issue.status)}
              </dd>
            </div>
          </dl>

          <div class="mt-5 border-t border-border pt-5">
            <h2 class="text-xs font-medium text-muted-foreground">{__("Description")}</h2>
            {/* `white-space: pre-wrap` rather than a Markdown renderer, and the
                text is shown as written — never as HTML. */}
            <p class="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-foreground">
              {this.issue.body?.trim() ? this.issue.body : __("No description was given.")}
            </p>
          </div>
        </div>

        <section>
          <h2 class="text-[0.9375rem] font-semibold">
            {this.comments.length === 1
              ? __("1 comment")
              : __("{count} comments", { count: this.comments.length })}
          </h2>

          {this.comments.length === 0 ? (
            <div class={`${CARD} mt-3 p-10 text-center`}>
              <h3 class="text-sm font-medium text-foreground">{__("No comments yet")}</h3>
              <p class="mt-1.5 text-sm text-muted-foreground">
                {__("Nobody has replied to this issue.")}
              </p>
            </div>
          ) : (
            <ul class="mt-3 space-y-2">
              {this.comments.map((comment) => (
                // `transition` fades the row in when the morph adds it, so a
                // comment appearing under your cursor reads as an arrival rather
                // than a reflow.
                <li key={String(comment.id)} transition class={`${CARD} p-4`}>
                  <p class="text-sm font-medium text-foreground">
                    {comment.author?.name ?? __("The system")}
                  </p>
                  <p class="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {comment.body}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div class={`${CARD} mt-3 p-5`}>
            <h3 class="text-sm font-medium">{__("Add a comment")}</h3>
            <form onSubmit={this.postComment} class="mt-3 space-y-3">
              <textarea rows="4" aria-label={__("Add a comment")} class={TEXTAREA} value={this.body}>
                {this.body}
              </textarea>
              <span error={this.errors.body} class={ERROR} />
              <button type="submit" loadingAttr="disabled" class={PRIMARY}>
                {__("Comment")}
              </button>
            </form>
          </div>
        </section>

        <section>
          <h2 class="text-[0.9375rem] font-semibold">
            {this.attachments.length === 1
              ? __("1 attachment")
              : __("{count} attachments", { count: this.attachments.length })}
          </h2>

          {this.attachments.length > 0 ? (
            <ul class="mt-3 space-y-2">
              {this.attachments.map((attachment) => (
                <li
                  key={String(attachment.id)}
                  transition
                  class={`${CARD} flex items-center justify-between gap-3 p-4`}
                >
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-foreground">
                      {attachment.originalName}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      {fileSize(attachment.size)} · {attachment.uploader ?? "—"}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    {/* A plain `<a>`, not a `<Link>`: this URL answers with bytes
                        and a Content-Disposition, and a Flow navigation would
                        try to patch a page out of a PDF. */}
                    <a href={`${base}/attachments/${attachment.id}`} class={SECONDARY}>
                      {__("Download")}
                    </a>
                    {this.canUpdate ? (
                      <button
                        onClick={() => this.removeAttachment(attachment.id)}
                        class="rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-destructive"
                      >
                        {__("Remove")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <div class={`${CARD} mt-3 p-5`}>
            <h3 class="text-sm font-medium">{__("Attach a file")}</h3>
            <p class="mt-1 text-xs text-muted-foreground">
              {__("Images, PDF, or plain text. Up to 8 MB.")}
            </p>

            {/* The dropzone POSTs the bytes to `/__flow/upload` and shows its own
                progress while they travel, which is the part a plain form cannot
                do: there, the page is simply gone until the upload finishes. */}
            <FileUpload
              bind={this.file}
              accept="image/*,.pdf,.txt,.log"
              maxSize="8mb"
              class="mt-3"
            />

            {this.file ? (
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <span class="text-sm text-muted-foreground">{this.file.name}</span>
                <button onClick={() => this.removeUpload("file")} class="text-sm hover:underline">
                  {__("Remove")}
                </button>
                <button onClick={this.attachFile} loadingAttr="disabled" class={PRIMARY}>
                  {__("Attach")}
                </button>
              </div>
            ) : null}

            {this.uploadError ? <p class={`${ERROR} mt-2`}>{this.uploadError}</p> : null}
          </div>
        </section>
      </div>
    );
  }
}
