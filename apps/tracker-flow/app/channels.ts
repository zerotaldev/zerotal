import { Broadcast } from "@zerotal/broadcasting";
import { Issue } from "@app/models/Issue.ts";
import type { User } from "@app/models/User.ts";

/**
 * Who may listen to what.
 *
 * Pointed at by `channels` in config/broadcasting.ts. It sits beside `app/routes`
 * rather than inside it because everything under that directory is a URL, and a
 * channel rule is not a page.
 *
 * The callback is the only thing between a subscriber and another reader's data,
 * so it verifies the issue exists rather than trusting the id in the channel
 * name. Every signed-in user may read every issue in this app — the policy only
 * restricts *editing* — so membership is "authenticated, and the issue is real".
 * `Broadcast.channel` denies guests before the callback runs.
 *
 * The callback names the user type it expects; `Broadcast.channel` infers it.
 * This rule does not read the user — being signed in is the whole requirement —
 * but a rule that did would get a real `User` rather than an `unknown` to cast.
 */
Broadcast.channel("issues.[issueId]", async (_user: User, issueId: string) => {
  const id = Number(issueId);
  // A non-numeric segment would otherwise reach the query as NaN and match
  // nothing in a way that reads like an authorization result rather than a
  // malformed request.
  if (!Number.isInteger(id) || id <= 0) return false;

  return (await Issue.query().where("id", id).first()) !== null;
});
