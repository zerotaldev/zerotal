import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Head, Link, useForm } from "@inertiajs/react";
import type { SocketState } from "@zerotal/client/Socket";
import AppShell from "../../Layouts/AppShell";
import PageHeader from "../../Components/PageHeader";
import Avatar from "../../Components/Avatar";
import { LabelChip, PriorityBadge, StatusBadge } from "../../Components/Badge";
import { Button, ButtonLink } from "../../Components/Button";
import { TextAreaField } from "../../Components/Field";
import EmptyState from "../../Components/EmptyState";
import { PaperclipIcon } from "../../Components/Icons";
import { getSocket, socketHeaders } from "../../lib/socket";
import { cn } from "../../lib/cn";
import { endpoint, type FormMethod } from "../../lib/endpoint";

/**
 * The `accept` filter, kept in step with `ATTACHMENT_MIMES` on the server by
 * being the same list. The input hint is a courtesy — the rule that decides is
 * `StoreAttachmentRequest`, and it runs whatever the file picker allowed.
 */
const ATTACHMENT_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log";

interface CommentRow {
  id: number;
  body: string;
  author: { name: string } | null;
  createdAt: string | null;
}

interface AttachmentRow {
  id: number;
  name: string;
  mime: string;
  size: number;
  uploader: { name: string } | null;
  createdAt: string | null;
}

/** Bytes as something a person reads. Binary units, one decimal past kilobytes. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

interface Props {
  project: { name: string; slug: string };
  issue: {
    id: number;
    title: string;
    body: string;
    status: string;
    priority: string;
    author: { id: number; name: string } | null;
    assignee: { id: number; name: string } | null;
    labels: { name: string; colour: string }[];
    createdAt: string | null;
    dueAt: string | null;
  };
  comments: CommentRow[];
  attachments: AttachmentRow[];
  can: { update: boolean };
}

/**
 * One issue: the description, the thread, and the facts down the side.
 *
 * `can.update` decides whether the Edit button is drawn. The route's
 * `Gate.authorize` is what actually enforces it — this only stops the interface
 * offering a door that would shut in your face. Both call the same policy, so
 * they cannot disagree about who may edit.
 */
export default function IssueShow({ project, issue, comments: served, attachments, can }: Props) {
  const { comments, live } = useLiveComments(issue.id, served);

  return (
    <>
      <Head title={`#${issue.id} ${issue.title}`} />

      <nav aria-label={__("Breadcrumb")} className="mb-2 text-xs text-muted-foreground">
        <Link href={route("projects")} className="transition-colors hover:text-foreground">
          {__("Projects")}
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <Link
          href={route("projects.show", { project: project.slug })}
          className="transition-colors hover:text-foreground"
        >
          {project.name}
        </Link>
        <span aria-hidden="true" className="px-1.5">
          /
        </span>
        <span className="text-foreground">#{issue.id}</span>
      </nav>

      <PageHeader
        title={issue.title}
        description={
          issue.createdAt
            ? __("#{id} · opened by {author} on {date}", {
                id: issue.id,
                author: issue.author?.name ?? "—",
                date: new Date(issue.createdAt).toLocaleDateString(),
              })
            : __("#{id} · opened by {author}", { id: issue.id, author: issue.author?.name ?? "—" })
        }
        actions={
          can.update ? (
            <ButtonLink
              href={route("projects.issues.edit.show", { project: project.slug, issue: issue.id })}
              variant="secondary"
            >
              {__("Edit")}
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="sr-only">{__("Description")}</h2>
            {issue.body ? (
              // Plain text for now. Markdown rendering is its own recipe, and a
              // half-rendered document is worse than an honest pre-formatted one.
              <p className="text-sm whitespace-pre-wrap text-foreground">{issue.body}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{__("No description was given.")}</p>
            )}
          </section>

          <Attachments
            attachments={attachments}
            target={endpoint("projects.issues.attachments.store", {
              project: project.slug,
              issue: issue.id,
            })}
            projectSlug={project.slug}
            issueId={issue.id}
          />

          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">
                {comments.length === 1
                  ? __("1 comment")
                  : __("{count} comments", { count: comments.length })}
              </h2>
              <LiveIndicator state={live} />
            </div>

            {comments.length === 0 ? (
              <div className="mt-3 rounded-xl border border-border bg-card">
                <EmptyState
                  title={__("No comments yet")}
                  description={__("Nobody has replied to this issue.")}
                />
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {comments.map((comment) => (
                  <li key={comment.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center gap-2">
                      <Avatar name={comment.author?.name ?? "Someone"} size="sm" />
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {comment.author?.name ?? "Someone"}
                        </span>
                        {comment.createdAt && ` · ${new Date(comment.createdAt).toLocaleString()}`}
                      </p>
                    </div>
                    <p className="mt-2 text-sm whitespace-pre-wrap">{comment.body}</p>
                  </li>
                ))}
              </ul>
            )}

            <CommentForm
              target={endpoint("projects.issues.comments.store", {
                project: project.slug,
                issue: issue.id,
              })}
            />
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <dl className="space-y-4 rounded-xl border border-border bg-card p-5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{__("Status")}</dt>
              <dd className="mt-1">
                <StatusBadge status={issue.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{__("Priority")}</dt>
              <dd className="mt-1">
                <PriorityBadge priority={issue.priority} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{__("Assignee")}</dt>
              <dd className="mt-1">{issue.assignee?.name ?? __("Unassigned")}</dd>
            </div>
            {issue.labels.length > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground">{__("Labels")}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {issue.labels.map((label) => (
                    <LabelChip key={label.name} {...label} />
                  ))}
                </dd>
              </div>
            )}
            {issue.dueAt && (
              <div>
                <dt className="text-xs text-muted-foreground">Due</dt>
                <dd className="mt-1">{new Date(issue.dueAt).toLocaleDateString()}</dd>
              </div>
            )}
          </dl>
        </aside>
      </div>
    </>
  );
}

/**
 * Attachments — feature 8.
 *
 * The upload is an ordinary Inertia form post with a `File` in its data, which
 * Inertia sends as `multipart/form-data` on its own. That is the whole client
 * side: no upload endpoint of its own, no progress protocol, the same
 * validation round trip every other form in this app uses.
 *
 * Each row links to the download route rather than to storage. The bytes are on
 * a private disk, so the link is a route that checks the session first — which
 * is why an attachment cannot be shared by pasting its URL to a stranger.
 */
function Attachments({
  attachments,
  target,
  projectSlug,
  issueId,
}: {
  attachments: AttachmentRow[];
  target: { url: string; method: FormMethod };
  projectSlug: string;
  issueId: number;
}) {
  const form = useForm<{ file: File | null }>({ file: null });
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.data.file) return;
    // Verb from the generated table, not typed out here — a route that changes
    // method changes this call with it.
    form.submit(target.method, target.url, {
      preserveScroll: true,
      onSuccess: () => {
        form.reset();
        // `reset()` clears the form state, not the DOM node — a file input keeps
        // its selection until told otherwise, and leaving it there would show a
        // filename that is no longer going to be sent.
        if (inputRef.current) inputRef.current.value = "";
      },
    });
  }

  return (
    <section>
      <h2 className="text-sm font-semibold">
        {attachments.length === 1
          ? __("1 attachment")
          : __("{count} attachments", { count: attachments.length })}
      </h2>

      {attachments.length > 0 && (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <a
                href={route("projects.issues.attachments.show", {
                  project: projectSlug,
                  issue: issueId,
                  attachment: attachment.id,
                })}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-muted/60"
              >
                <PaperclipIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {attachment.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatBytes(attachment.size)}
                    {attachment.uploader && ` · ${attachment.uploader.name}`}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {__("Download")}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-3 rounded-xl border border-border bg-card p-4">
        <label htmlFor="attachment" className="block text-sm font-medium text-foreground">
          {__("Attach a file")}
        </label>

        <input
          id="attachment"
          ref={inputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          onChange={(event) => form.setData("file", event.target.files?.[0] ?? null)}
          aria-invalid={form.errors.file ? true : undefined}
          aria-describedby={form.errors.file ? "attachment-error" : "attachment-hint"}
          className="mt-1.5 block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted"
        />

        {form.errors.file ? (
          <p id="attachment-error" role="alert" className="mt-1.5 text-sm text-destructive">
            {form.errors.file}
          </p>
        ) : (
          <p id="attachment-hint" className="mt-1.5 text-xs text-muted-foreground">
            {__("Images, PDF, or plain text. Up to 8 MB.")}
          </p>
        )}

        {/* Inertia reports upload progress for a multipart visit, so a large file
            says something while it climbs rather than sitting on "Uploading…". */}
        <div className="mt-3 flex items-center justify-end gap-3">
          {form.progress && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {form.progress.percentage ?? 0}%
            </p>
          )}
          <Button type="submit" disabled={form.processing || !form.data.file}>
            {form.processing ? __("Uploading…") : __("Attach")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * The thread, kept current from two sources — feature 7.
 *
 * The server's copy is the truth: every Inertia response carries the whole
 * thread, so a navigation or a redirect-back replaces local state outright
 * rather than merging into it. Between responses the socket fills the gap.
 *
 * Arrivals are deduplicated by id because the two sources overlap. `toOthers()`
 * on the server keeps the author's own comment off their socket, but a reconnect
 * re-subscribes and a redirect can land either side of a broadcast — so the
 * guard is what makes the ordering not matter.
 */
function useLiveComments(issueId: number, served: CommentRow[]) {
  const [comments, setComments] = useState(served);
  const [live, setLive] = useState<SocketState>("connecting");

  // `served` is a fresh array on every Inertia response, so this resets the
  // thread exactly when the server has re-sent it and at no other time.
  useEffect(() => setComments(served), [served]);

  useEffect(() => {
    const socket = getSocket();
    setLive(socket.state);

    const states: SocketState[] = [
      "connecting",
      "connected",
      "disconnected",
      "reconnecting",
      "error",
    ];
    const offs = states.map((state) => socket.on(state, () => setLive(state)));

    const channel = socket.private(`issues.${issueId}`);
    const onPosted = (event: unknown) => {
      const posted = (event as { comment?: CommentRow }).comment;
      if (!posted) return;
      setComments((prev) => (prev.some((c) => c.id === posted.id) ? prev : [...prev, posted]));
    };
    channel.listen("CommentPosted", onPosted);

    return () => {
      channel.stopListening("CommentPosted", onPosted);
      // The channel itself is left subscribed: the socket is shared, and another
      // page mounting the same issue would have to re-authorize to get it back.
      offs.forEach((off) => off());
    };
  }, [issueId]);

  return { comments, live };
}

/** Whether new comments will arrive without a reload. */
function LiveIndicator({ state }: { state: SocketState }) {
  const connected = state === "connected";
  const label = connected
    ? __("Live — new comments appear as they are posted")
    : state === "error" || state === "disconnected"
      ? __("Not live — reload to see new comments")
      : __("Connecting…");

  return (
    <span title={label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          connected
            ? "bg-success"
            : state === "error"
              ? "bg-destructive"
              : "bg-muted-foreground/50",
        )}
      />
      {/* The dot is decoration; this is the part a screen reader reads, and it
          is a live region so a dropped connection announces itself. */}
      <span role="status" className="sr-only">
        {label}
      </span>
      <span aria-hidden="true">
        {connected ? __("Live") : state === "connecting" ? "…" : __("Offline")}
      </span>
    </span>
  );
}

/**
 * Posting a comment.
 *
 * `socketHeaders()` rides along so the server can exclude this connection from
 * the broadcast — the response already re-renders the thread with the new
 * comment in it, and without the header the socket would deliver a second copy.
 */
function CommentForm({ target }: { target: { url: string; method: FormMethod } }) {
  const form = useForm({ body: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    form.submit(target.method, target.url, {
      preserveScroll: true,
      headers: socketHeaders(),
      onSuccess: () => form.reset(),
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-border bg-card p-4">
      <TextAreaField
        label={__("Add a comment")}
        name="body"
        rows={3}
        value={form.data.body}
        error={form.errors.body}
        onChange={(event) => form.setData("body", event.target.value)}
      />

      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={form.processing || form.data.body.trim() === ""}>
          {form.processing ? __("Posting…") : __("Comment")}
        </Button>
      </div>
    </form>
  );
}

IssueShow.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;
