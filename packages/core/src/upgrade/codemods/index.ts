/**
 * Every codemod, in one list.
 *
 * The runner orders by version, so the order here is only what a reader sees.
 * A codemod belongs here the moment its ledger entry is decided, even if the
 * release that needs it is some way off — the roadmap's rule is that every
 * ledger entry which *can* have a codemod has one before 2.0 ships, and the way
 * that rule fails is by everyone assuming there is time.
 */
import type { Codemod } from "../types.ts";
import { deprecatedAliases } from "./deprecated-aliases.ts";
import { clientTaggedTemplate } from "./client-tagged-template.ts";

export const CODEMODS: Codemod[] = [clientTaggedTemplate, deprecatedAliases];

export { deprecatedAliases, clientTaggedTemplate };
