import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware } from "@zerotal/core";
import { Auth } from "./facades/Auth.ts";

export interface BasicAuthOptions {
  /** Credential column used as the "username". Default `email`. */
  field?: string;
  /** Realm shown in the browser's auth prompt. Default `Restricted`. */
  realm?: string;
}

/**
 * HTTP Basic authentication.
 *
 * Reads the `Authorization: Basic` header, looks the user up by `field`, and
 * verifies the password. On success `ctx.user` is set for this request only —
 * no session is created (stateless), so it suits simple API endpoints. On
 * failure it returns `401` with a `WWW-Authenticate` challenge, prompting the
 * browser for credentials.
 *
 * @example
 * Router.get("/api/ping", PingController, "show", [BasicAuthMiddleware]);
 * // Authenticate by a different column / realm:
 * BasicAuthMiddleware.with({ field: "username", realm: "Admin" })
 */
export class BasicAuthMiddleware extends BaseMiddleware<BasicAuthOptions> {
  protected options: BasicAuthOptions = { field: "email", realm: "Restricted" };

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const creds = _parseBasic(http.request.headers.get("Authorization") ?? "");
    if (creds) {
      const ok = await Auth.once({
        [this.options.field ?? "email"]: creds.user,
        password: creds.pass,
      });
      if (ok) return next();
    }

    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${this.options.realm ?? "Restricted"}", charset="UTF-8"`,
      },
    });
  }
}

/** Decode a `Basic base64(user:pass)` header into its parts, or null. */
function _parseBasic(header: string): { user: string; pass: string } | null {
  if (!header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i === -1) return null;
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}
