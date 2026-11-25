import type { HtmlNode } from "@zerotal/flow";
import type { ProjectStatus } from "@app/models/Project";
import { Badge, type BadgeTone } from "./Badge";

/** How each status shows: the badge's tone, and its words. Pages read it too. */
export const PROJECT_STATUS: Record<ProjectStatus, { tone: BadgeTone; label: string }> = {
  planning: { tone: "neutral", label: "Planning" },
  active: { tone: "primary", label: "Active" },
  completed: { tone: "success", label: "Completed" },
};

/** A project's status as a coloured label. Part of the example resource. */
export function ProjectStatusBadge({ status }: { status: ProjectStatus }): HtmlNode {
  const { tone, label } = PROJECT_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
