/**
 * A JSON POST to this app, for the few calls that are not page visits — the passkey
 * ceremonies, where the browser's WebAuthn API sits between two requests.
 *
 * Everything else is a link or a form: the browser sends it, the server redirects, and
 * the next page arrives whole. forms.ts covers the forms a browser can't send alone.
 */
export async function postJson<T = unknown>(
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: T }> {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...xsrfHeader(),
    },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

/** The anti-forgery token, when the app sets one, echoed back the way the server expects. */
function xsrfHeader(): Record<string, string> {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match?.[1] ? { "X-XSRF-TOKEN": decodeURIComponent(match[1]) } : {};
}
