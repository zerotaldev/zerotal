import { Component } from "@zerotal/flow";
import { RequestContext, type HttpContext } from "zerotal";
import type { User } from "@app/models/User";
import { passkeysEnabled } from "@app/auth/passkeys";
import { documentHead } from "./document";
import { appName } from "./site";

/** The four tones a flash message comes in — `http.flash("success", "…")` and so on. */
export type FlashKind = "success" | "error" | "warning" | "info";

/**
 * What the layouts need to know about the request: who is signed in, where they are,
 * and what the last request flashed. A page hands it to its layout with `this.shell()`.
 */
export interface Shell {
  appName: string;
  user: { name: string; email: string } | null;
  /** The path being shown, for marking the current item in a menu. */
  path: string;
  flash: Partial<Record<FlashKind, string>>;
  /** Passkeys are on (PASSKEY_RP_ID is set), so Settings shows them. */
  passkeys: boolean;
}

const FLASH_KINDS: readonly FlashKind[] = ["success", "error", "warning", "info"];

/**
 * The title every page shows in the tab: its own, then the app's name.
 *
 *   static title = titled("Sign in");   // "Sign in — Acme"
 *
 * A function, so the name is read per request rather than once at import.
 */
export function titled(title: string): () => string {
  return () => {
    const name = appName();
    return title && name ? `${title} — ${name}` : title || name;
  };
}

/**
 * The base of every page in app/flow/pages/.
 *
 * Most pages here are server-rendered and nothing more: the form on them posts to a
 * handler in app/routes/, which validates and redirects back. So a page is static by
 * default — no snapshot and no WebSocket — and one that needs live state (the project
 * search) turns `interactive` back on.
 *
 * On each request it reads what the last form post left in the session: the field
 * errors and the submitted input, from a failed `validate()` or `rejectInput()`, and any
 * flash messages. `this.error("email")` and `this.old("email")` read them back.
 */
export abstract class Page extends Component {
  static override interactive = false;

  /** The icon, stylesheet, script and theme line every page needs. See lib/document.ts. */
  static get head(): string {
    return documentHead();
  }

  /** The request being answered. Null only for a page built outside one. */
  protected http: HttpContext | null = null;
  protected user: User | null = null;
  protected path = "/";
  protected flashes: Partial<Record<FlashKind, string>> = {};
  private fieldErrors: Record<string, string> = {};
  private oldInput: Record<string, unknown> = {};

  override async onBoot(ctx?: HttpContext): Promise<void> {
    // Flow hands the request over; a page built another way (a test) finds it in scope.
    const http = ctx ?? RequestContext.tryGet() ?? null;
    if (!http) return;
    this.http = http;
    // Typed as app/models/User by the `UserModel` declaration in bootstrap/app.ts.
    this.user = http.user ?? null;
    this.path = http.url.pathname;

    const session = http.session;
    // Read once: a reload after a failed post shows a clean form, as it would anywhere.
    this.fieldErrors = session?.get<Record<string, string>>("errors") ?? {};
    this.oldInput = session?.get<Record<string, unknown>>("old") ?? {};
    session?.forget("errors");
    session?.forget("old");

    for (const kind of FLASH_KINDS) {
      const message = session?.get(kind);
      if (typeof message === "string" && message) this.flashes[kind] = message;
    }
  }

  /** The message for a field that failed validation, if it did. */
  protected error(field: string): string | undefined {
    return this.fieldErrors[field];
  }

  /**
   * What was typed into a field before a failed post, so the form comes back filled in.
   * Never used for a password: those are left empty on purpose.
   */
  protected old(field: string, fallback = ""): string {
    const value = this.oldInput[field];
    return typeof value === "string" ? value : fallback;
  }

  /** What the layout needs. */
  protected shell(): Shell {
    return {
      appName: appName(),
      user: this.user ? { name: this.user.name, email: this.user.email } : null,
      path: this.path,
      flash: this.flashes,
      passkeys: passkeysEnabled(),
    };
  }
}
