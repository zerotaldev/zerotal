import { Component, Head, Link, expose, locked } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Auth, AuthMiddleware, Gate } from "zerotal/auth";
import type { Project } from "@app/models/Project.ts";
import { Issue, ISSUE_STATUSES, type IssueStatus } from "@app/models/Issue.ts";
import { UserLocaleMiddleware } from "@app/middleware/UserLocaleMiddleware.ts";
import { AppLayout } from "../../../layouts/app.tsx";
import {
  BADGE,
  CARD,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SECONDARY,
  STATUS_LABEL,
} from "../../../ui.ts";

export const middleware = [AuthMiddleware, UserLocaleMiddleware];

/** One card, as the board draws it. */
interface CardRow {
  id: number;
  title: string;
  priority: string;
  assignee: string | null;
  /** Whether *this* reader may move it — the policy, resolved once per load. */
  movable: boolean;
}

interface Column {
  status: IssueStatus;
  issues: CardRow[];
}

/**
 * GET /projects/:project/board — feature 9, and the page this build exists for.
 *
 * The view build's board is read-only and says so in its own docblock: dragging
 * needs a script, and `POST /board` takes `{ status, issueIds: number[] }`,
 * which a plain `<form>` cannot encode. Both objections are answered here by the
 * same fact — there is no form and no endpoint. A drop calls a method on this
 * class with the card and its new index, and the server writes the column.
 *
 * ## One action per column, and why
 *
 * `onSort` compiles to `flow:sort="<methodName>"`, and the client reads that
 * attribute off the **container the card was dropped into** and calls it with
 * `(key, index)` — see `_setupSort` in the runtime. The destination is therefore
 * encoded in *which method runs*, and nowhere else: the payload carries the card
 * and the position but not the column. An arrow function (`onSort={(k, i) =>
 * this.move(status, k, i)}`) cannot work, because the attribute's value is used
 * as a method name rather than evaluated.
 *
 * So there are five thin wrappers below, one per status, each delegating to one
 * implementation. They are written out rather than generated because a decorator
 * has to be attached to a declared member. This is the honest cost of the
 * feature as it stands; a `flow:sort:into` attribute carrying the container's
 * own key would remove it, and is worth having.
 *
 * ## What a drop writes
 *
 * The destination column **in full**, which is the same contract
 * `ReorderBoardRequest` defines for the Inertia build: replaying a drop lands on
 * the same board, and there is no fractional-position arithmetic to drift. The
 * source column needs no write — removing a card leaves the remaining positions
 * valid, because they are sparse.
 */
export class BoardPage extends Component {
  static layout = AppLayout;
  static title = "Board";

  @locked project!: Project;
  @locked columns: Column[] = [];

  override async onMount(): Promise<void> {
    await this.loadBoard();
  }

  private async loadBoard(): Promise<void> {
    // One query for every issue in the project, grouped in memory. Grouping here
    // rather than five status-scoped queries is the difference between one round
    // trip and five, and the board is the page where that is most visible in a
    // trace. Identical to the other two builds.
    const issues = await Issue.query()
      .where("project_id", this.project.id)
      .with("assignee")
      .orderBy("position", "asc")
      .orderBy("id", "asc")
      .get();

    this.columns = ISSUE_STATUSES.map((status) => ({
      status,
      issues: issues
        .filter((issue) => issue.status === status)
        .map((issue) => ({
          id: issue.id,
          title: issue.title,
          priority: issue.priority,
          assignee: issue.assignee?.name ?? null,
          // Resolved here, once, rather than in the template: the board draws up
          // to five columns of cards and `Gate.allows` is a policy call each
          // time. It also decides which cards get `sortIgnore`, so the answer
          // has to exist before the markup does.
          movable: Gate.allows("update", issue),
        })),
    }));
  }

  // ── The five drop targets ───────────────────────────────────────────────────
  // See the class docblock: the destination column is the method that runs.

  @expose async dropInBacklog(key: string, index: number): Promise<void> {
    await this.move("backlog", key, index);
  }
  @expose async dropInTodo(key: string, index: number): Promise<void> {
    await this.move("todo", key, index);
  }
  @expose async dropInProgress(key: string, index: number): Promise<void> {
    await this.move("in_progress", key, index);
  }
  @expose async dropInDone(key: string, index: number): Promise<void> {
    await this.move("done", key, index);
  }
  @expose async dropInCancelled(key: string, index: number): Promise<void> {
    await this.move("cancelled", key, index);
  }

  /**
   * Move one card into `status` at `index`, and write that column.
   *
   * `key` arrives from the browser, so nothing in it is trusted: the id is
   * matched against the board this reader was actually served, and the policy is
   * re-checked. `sortIgnore` already stops an unmovable card being dragged, but
   * that is a courtesy in the DOM — the action is reachable over the socket by
   * anyone with the page open.
   */
  private async move(status: IssueStatus, key: string, index: number): Promise<void> {
    const id = Number(key);
    if (!Number.isInteger(id)) return;

    const source = this.columns.find((column) => column.issues.some((card) => card.id === id));
    const card = source?.issues.find((c) => c.id === id);
    if (!source || !card) return;

    if (!card.movable) {
      this.flash(__("Only the person who opened an issue can move it."), "error");
      return;
    }

    const issue = await Issue.query()
      .where("id", id)
      .where("project_id", this.project.id)
      .first();
    // The `project_id` clause is the check, not a filter: without it an id from
    // another project would be moved by a socket frame naming this board.
    if (!issue) return;
    Gate.authorize("update", issue);

    const destination = this.columns.find((column) => column.status === status);
    if (!destination) return;

    // Reordered in memory first, so the write below and the re-render agree
    // without a second read.
    source.issues = source.issues.filter((c) => c.id !== id);
    const at = Math.max(0, Math.min(index, destination.issues.length));
    destination.issues.splice(at, 0, card);

    issue.status = status;
    await issue.save();

    // The destination column in full — see the class docblock. One statement per
    // card rather than a single `CASE`, because the column is bounded by what a
    // person can see on a screen and clarity is worth more here than a query.
    await Promise.all(
      destination.issues.map((c, position) =>
        Issue.query().where("id", c.id).update({ position }),
      ),
    );

    // Reassigned rather than mutated in place: Flow diffs the snapshot, and a
    // `splice` on a nested array is a write the diff cannot see.
    this.columns = [...this.columns];
  }

  async render(): Promise<HtmlNode> {
    const base = `/projects/${this.project.slug}`;
    // Paired with the columns so each container gets its own drop action. The
    // order is `ISSUE_STATUSES`, which is board order.
    const DROP: Record<IssueStatus, string> = {
      backlog: "dropInBacklog",
      todo: "dropInTodo",
      in_progress: "dropInProgress",
      done: "dropInDone",
      cancelled: "dropInCancelled",
    };

    return (
      <div class="space-y-6">
        <Head>
          <title>{`${__("Board")} · ${this.project.name} — Tracker`}</title>
        </Head>

        <nav aria-label={__("Breadcrumb")} class="text-xs text-muted-foreground">
          <Link href="/projects" hover class="hover:text-foreground">
            {__("Projects")}
          </Link>
          <span aria-hidden="true" class="px-1.5">
            /
          </span>
          <Link href={base} hover class="hover:text-foreground">
            {this.project.name}
          </Link>
        </nav>

        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-xl font-semibold tracking-tight">{__("Board")}</h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {__("Drag a card to move it. Only issues you opened can be moved.")}
            </p>
          </div>
          <Link href={base} hover class={SECONDARY}>
            {__("List view")}
          </Link>
        </div>

        {/* Horizontal scroll rather than a wrapping grid: five columns that
            reflow into two rows stop reading as a pipeline. */}
        <div class="flex gap-4 overflow-x-auto pb-2">
          {this.columns.map((column) => (
            <section key={column.status} class="w-72 shrink-0">
              <h2 class="flex items-center justify-between gap-2 px-1 pb-2">
                <span class="text-sm font-medium">
                  {__(STATUS_LABEL[column.status] ?? column.status)}
                </span>
                <span class="text-xs text-muted-foreground tabular-nums">
                  {String(column.issues.length)}
                </span>
              </h2>

              {/* `sortGroup` is what lets a card cross columns: the runtime only
                  accepts a drop from another container when both name the same
                  group. Without it each column would reorder but never hand
                  over. */}
              {/* `onSort` takes the method *name* here rather than a reference.
                  The prop accepts either — a function is stringified to its
                  `.name`, a string goes out as the attribute value — and the
                  name is what the client reads back off the container. A
                  reference would mean five names hard-coded at five call sites
                  instead of one table. */}
              <ul
                onSort={DROP[column.status]}
                sortGroup="issues"
                class="min-h-16 space-y-2 rounded-xl"
              >
                {column.issues.map((card) => (
                  <li
                    key={String(card.id)}
                    sortItem={String(card.id)}
                    sortIgnore={!card.movable}
                    transition
                    class={`${CARD} p-3 ${card.movable ? "cursor-grab active:cursor-grabbing" : "opacity-80"}`}
                  >
                    <Link
                      href={`${base}/issues/${card.id}`}
                      down
                      class="block text-sm font-medium text-card-foreground hover:text-primary"
                    >
                      {card.title}
                    </Link>
                    <div class="mt-2 flex items-center justify-between gap-2">
                      <span class={`${BADGE} ${PRIORITY_TONE[card.priority] ?? ""}`}>
                        {__(PRIORITY_LABEL[card.priority] ?? card.priority)}
                      </span>
                      <span class="truncate text-xs text-muted-foreground">
                        {card.assignee ?? __("Unassigned")}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>

              {column.issues.length === 0 ? (
                <p class="mt-2 rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                  {__("Nothing here")}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    );
  }
}
