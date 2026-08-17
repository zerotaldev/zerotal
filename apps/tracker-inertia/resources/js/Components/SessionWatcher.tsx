import { useEffect, useRef, useState } from "react";
import { router, usePage } from "@inertiajs/react";
import { Button } from "./Button";
import { subscribe } from "../lib/session";
import type { SharedProps } from "../types";

/**
 * What a live page does when its session ends underneath it — feature 14.
 *
 * Two ways to find out, because there are two ways it happens:
 *
 *   another tab   — `BroadcastChannel` says so the instant it occurs
 *   this tab      — a visit comes back with `auth.user` gone, which is what the
 *                   guard does when the session expired on its own
 *
 * The second is the one that needs no other tab involved, and it is why this
 * watches the shared prop rather than only listening on the channel.
 *
 * It does **not** redirect. A reader with a half-written comment should not lose
 * it to a navigation they did not ask for — the page stays, the dialog explains,
 * and signing in again is a choice. That is the whole difference between
 * handling this and merely detecting it.
 */
export default function SessionWatcher() {
  const user = usePage<SharedProps>().props.auth?.user ?? null;
  const [ended, setEnded] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasSignedIn = useRef(Boolean(user));

  // Another tab signed out.
  useEffect(() => subscribe((event) => event === "signed-out" && setEnded(true)), []);

  // This tab's own session went away between visits.
  useEffect(() => {
    if (wasSignedIn.current && !user) setEnded(true);
    if (user) {
      wasSignedIn.current = true;
      setEnded(false);
    }
  }, [user]);

  // Focus the dialog when it appears, so a keyboard reader is not left behind on
  // a page that has just become inert.
  useEffect(() => {
    if (ended) dialogRef.current?.focus();
  }, [ended]);

  if (!ended) return null;

  return (
    <div className="fixed inset-0 z-70 grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-ended-title"
        aria-describedby="session-ended-body"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg"
      >
        <h2 id="session-ended-title" className="text-base font-semibold text-card-foreground">
          {__("You were signed out")}
        </h2>

        <p id="session-ended-body" className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {__("Your session ended in another tab. Anything unsaved on this page is still here, but you will need to sign in again to continue.")}
        </p>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setEnded(false)}>
            {__("Stay on this page")}
          </Button>
          <Button onClick={() => router.visit(route("login"))}>{__("Sign in again")}</Button>
        </div>
      </div>
    </div>
  );
}
