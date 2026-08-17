import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Head, Link, router } from "@inertiajs/react";
import AppShell from "../../Layouts/AppShell";
import PageHeader from "../../Components/PageHeader";
import { PriorityBadge, STATUS_LABEL } from "../../Components/Badge";
import { ButtonLink } from "../../Components/Button";
import Avatar from "../../Components/Avatar";
import { cn } from "../../lib/cn";
import { endpoint } from "../../lib/endpoint";

interface Card {
  id: number;
  title: string;
  priority: string;
  assignee: { name: string } | null;
}

interface Column {
  status: string;
  issues: Card[];
}

interface Props {
  project: { name: string; slug: string };
  columns: Column[];
  statuses: readonly string[];
}

/**
 * The board — feature 9, and the one screen where optimistic UI is the point.
 *
 * State is held locally and moved the instant the card is dropped, then the
 * destination column is posted. The reader never waits for the server to agree:
 * a drag that takes 200ms to confirm feels broken even though nothing is wrong.
 * If the post fails, the flash says so and a reload restores the server's board
 * — the local copy is a bet, not a second source of truth.
 *
 * Dragging is not the only way to move a card. Every card carries keyboard
 * controls, because a board that can only be operated with a mouse excludes
 * people for no reason the domain requires — see the note on `move` below.
 */
export default function Board({ project, columns: served, statuses }: Props) {
  /** The same status→English map the badges use, then translated. */
  const statusLabel = (s: string) => __(STATUS_LABEL[s] ?? s.replace("_", " "));
  const [columns, setColumns] = useState(served);
  const [dragging, setDragging] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const dragOver = useRef<string | null>(null);

  const columnOf = (id: number) => columns.find((c) => c.issues.some((i) => i.id === id));

  /**
   * Move one card to a status and index, update locally, then persist.
   *
   * Shared by the pointer path and the keyboard path so the two cannot diverge
   * — the drag handler and the arrow keys are two ways of calling this, not two
   * implementations of it.
   */
  function move(id: number, toStatus: string, toIndex: number) {
    const card = columns.flatMap((c) => c.issues).find((i) => i.id === id);
    if (!card) return;

    const next = columns.map((column) => ({
      ...column,
      issues: column.issues.filter((issue) => issue.id !== id),
    }));

    const target = next.find((column) => column.status === toStatus);
    if (!target) return;

    const index = Math.max(0, Math.min(toIndex, target.issues.length));
    target.issues.splice(index, 0, card);
    setColumns(next);

    setAnnouncement(`${card.title} moved to ${statusLabel(toStatus)}, position ${index + 1}.`);

    const persist = endpoint("projects.board.store", { project: project.slug });
    router.visit(persist.url, {
      method: persist.method,
      data: { status: toStatus, issueIds: target.issues.map((issue) => issue.id) },
      preserveScroll: true,
      preserveState: true,
      // The board is already showing the outcome; a re-render from the
      // response would only redraw what the reader is looking at.
      only: [],
    });
  }

  /** Arrow keys move the focused card: left/right across columns, up/down within. */
  function onCardKeyDown(event: KeyboardEvent, card: Card) {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key) || !event.shiftKey) return;
    event.preventDefault();

    const column = columnOf(card.id);
    if (!column) return;
    const columnIndex = statuses.indexOf(column.status);
    const cardIndex = column.issues.findIndex((issue) => issue.id === card.id);

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      move(card.id, column.status, cardIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else {
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = statuses[columnIndex + delta];
      if (next) move(card.id, next, 0);
    }

    // Keep the moved card focused so a sequence of moves is possible without
    // reaching for the mouse to pick it up again.
    requestAnimationFrame(() => document.getElementById(`card-${card.id}`)?.focus());
  }

  function onDrop(event: DragEvent, status: string, index: number) {
    event.preventDefault();
    dragOver.current = null;
    const id = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isInteger(id) && id > 0) move(id, status, index);
    setDragging(null);
  }

  return (
    <>
      <Head title={`${project.name} board`} />

      <div className="space-y-6">
        <div>
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
            <span className="text-foreground">{__("Board")}</span>
          </nav>

          <PageHeader
            title={__("Board")}
            description={__("Drag a card to move it, or focus one and hold Shift with the arrow keys.")}
            actions={
              <ButtonLink
                href={route("projects.show", { project: project.slug })}
                variant="secondary"
              >
                {__("List view")}
              </ButtonLink>
            }
          />
        </div>

        {/* Every move is announced, so the board is followable without seeing it. */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {columns.map((column) => (
            <section
              key={column.status}
              onDragOver={(event) => {
                event.preventDefault();
                dragOver.current = column.status;
              }}
              onDrop={(event) => onDrop(event, column.status, column.issues.length)}
              className={cn(
                "flex flex-col rounded-xl border border-border bg-card",
                dragging !== null && "border-dashed",
              )}
            >
              <h2 className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-sm font-semibold">
                {statusLabel(column.status)}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {column.issues.length}
                </span>
              </h2>

              <ul className="flex-1 space-y-2 p-2">
                {column.issues.map((card, index) => (
                  <li key={card.id}>
                    <article
                      id={`card-${card.id}`}
                      tabIndex={0}
                      draggable
                      aria-roledescription={__("Draggable card")}
                      aria-label={`${card.title}. ${statusLabel(column.status)}, position ${index + 1} of ${column.issues.length}. Shift with arrow keys to move.`}
                      onKeyDown={(event) => onCardKeyDown(event, card)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", String(card.id));
                        setDragging(card.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                      onDrop={(event) => {
                        event.stopPropagation();
                        onDrop(event, column.status, index);
                      }}
                      className={cn(
                        "cursor-grab rounded-md border border-border bg-background p-3 transition-[border-color,opacity] duration-150 hover:border-muted-foreground/30",
                        dragging === card.id && "opacity-50",
                      )}
                    >
                      <Link
                        href={route("projects.issues.show", {
                          project: project.slug,
                          issue: card.id,
                        })}
                        className="block text-sm font-medium text-foreground hover:underline"
                      >
                        {card.title}
                      </Link>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <PriorityBadge priority={card.priority} />
                        {card.assignee && <Avatar name={card.assignee.name} size="sm" />}
                      </div>
                    </article>
                  </li>
                ))}

                {column.issues.length === 0 && (
                  <li className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {__("Nothing here")}
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

Board.layout = (page: ReactNode) => <AppShell>{page}</AppShell>;
