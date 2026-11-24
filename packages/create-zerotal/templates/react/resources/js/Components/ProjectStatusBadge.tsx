import { Badge, type BadgeTone } from "./Badge";
import type { ProjectStatus } from "../types";

const TONE: Record<ProjectStatus, BadgeTone> = {
  planning: "neutral",
  active: "primary",
  completed: "success",
};

const LABEL: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  completed: "Completed",
};

/** A project's status as a coloured label. Part of the example resource. */
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
