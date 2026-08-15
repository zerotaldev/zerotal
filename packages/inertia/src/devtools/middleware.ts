/**
 * The middleware half of the DevTools protocol: open a recording, stamp the
 * correlation headers on the way out, and inject the discovery script tag into
 * the initial HTML.
 *
 * Registered automatically by `InertiaProvider` when the recorder is enabled, so
 * an app adds nothing to its middleware stack. It sits outside `InertiaMiddleware`
 * so the status it records is the one actually sent — the 302→303 rewrite and the
 * version-mismatch 409 both happen in there.
 */
import type { HttpContext, NextFn } from "@zerotal/core";
import { BaseMiddleware } from "@zerotal/core";
import { beginRecording, finishRecording } from "./recorder.ts";
import { devtoolsEnabled, isRecordablePath } from "./enabled.ts";
import { DEVTOOLS_REQUEST_HEADERS, DEVTOOLS_RESPONSE_HEADERS } from "./types.ts";

/**
 * The discovery script tag for the initial full-page response.
 *
 * The extension needs the entry id before any XHR happens, and the first
 * document load has no earlier response to have carried it. The id is a UUID,
 * so it needs no escaping — but it is JSON-encoded anyway, because the protocol
 * specifies a JSON string and a bare id would not parse as one.
 */
export function devtoolsScriptTag(id: string): string {
  return `<script data-inertia-devtools-id type="application/json">${JSON.stringify(id)}</script>`;
}

/** Insert the discovery tag before `</head>`, or before `</body>` if there is no head. */
function injectScriptTag(html: string, id: string): string {
  const tag = devtoolsScriptTag(id);
  if (html.includes("</head>")) return html.replace("</head>", `${tag}</head>`);
  if (html.includes("</body>")) return html.replace("</body>", `${tag}</body>`);
  return html + tag;
}

/**
 * Records each request for the Inertia DevTools extension.
 *
 * @see https://inertiajs.com/docs/v3/advanced/devtools-protocol
 */
export class InertiaDevtoolsMiddleware extends BaseMiddleware {
  protected options: Record<string, never> = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    if (!devtoolsEnabled() || !isRecordablePath(http.url.pathname)) return next();

    const id = beginRecording(http);

    // The batch root: the id the client says started this chain, or this entry
    // itself when it is the start. Echoing it back lets the extension group a
    // navigation with the deferred-prop requests it triggers.
    const parentOut = http.request.headers.get(DEVTOOLS_REQUEST_HEADERS.parent) ?? id;

    const response = await next();
    if (!response) return;

    const contentType = response.headers.get("Content-Type") ?? "";

    // Never touch a stream: rebuilding the Response to add a header would
    // transfer the body and can stall a long-lived SSE connection.
    if (contentType.startsWith("text/event-stream")) return response;

    let out = response;

    // Inject discovery into the initial document. Reading the body is safe here
    // — an HTML page is buffered, not streamed — and it is the only way the
    // extension learns the id before the first XHR.
    if (contentType.includes("text/html")) {
      const html = await response.text();
      out = new Response(injectScriptTag(html, id), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    out.headers.set(DEVTOOLS_RESPONSE_HEADERS.id, id);
    out.headers.set(DEVTOOLS_RESPONSE_HEADERS.parentOut, parentOut);

    finishRecording(http, out, parentOut);
    return out;
  }
}
