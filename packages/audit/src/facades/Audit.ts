import { createFacade } from "@zerotal/core";
import type { Auditor } from "../Auditor.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    audit: Auditor;
  }
}

/**
 * Audit facade — access the Auditor service from anywhere after boot.
 *
 * @example
 * import { Audit } from "@zerotal/audit";
 *
 * await Audit.log("password.changed", {
 *   auditable_type: "User",
 *   auditable_id:   user.id,
 * });
 *
 * const history = await Audit.historyFor("User", user.id, 25);
 */
export const Audit = createFacade("audit");
