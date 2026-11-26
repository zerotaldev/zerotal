/**
 * The browser half of dev live-reload: an inline script injected into dev HTML
 * responses. It connects to `/__dev/ws` and reloads the tab on two signals.
 *
 *   • `reload` — the orchestrator finished a rebuild triggered by a frontend
 *     change and pushed it straight through the worker.
 *
 *   • `version:<token>` — sent by the worker the moment a socket opens. A
 *     backend change also rebuilds assets, but it restarts the worker, and the
 *     restart kills every socket: a `reload` pushed at that instant reaches
 *     nobody, because the tab only reconnects a second later. So the tab
 *     remembers the build token it first saw and reloads when a reconnect
 *     reports a different one. That is how a rebuild riding along with a
 *     server restart still reaches the browser.
 *
 * Reconnecting on close (rather than on error) is what keeps a server restart
 * from wedging the page without spinning up a reload loop.
 *
 * Served as a file, `/__dev/reload.js`, and pulled in with a `<script src>` tag,
 * not inlined. An inline script needs `'unsafe-inline'` or a nonce in the page's
 * Content-Security-Policy, so an app with a strict policy had to loosen it in
 * development to keep live-reload. A script from the app's own origin is allowed
 * by `script-src 'self'`, the same way Flow's runtime under `/__flow/` is.
 *
 * @internal
 */
export const DEV_RELOAD_SCRIPT_PATH = "/__dev/reload.js";

/**
 * The tag `DevReloadMiddleware` injects into dev HTML responses, and Inertia bakes
 * into its cached template so streamed pages need no body rewrite.
 *
 * @internal
 */
export const DEV_RELOAD_CLIENT: string = `<script src="${DEV_RELOAD_SCRIPT_PATH}"></script>`;

/**
 * The script served at {@link DEV_RELOAD_SCRIPT_PATH}.
 *
 * @internal
 */
export const DEV_RELOAD_SOURCE: string =
  `(function(){` +
  `var proto=location.protocol==='https:'?'wss:':'ws:';` +
  `var build=null;` +
  `function connect(){` +
  `var ws=new WebSocket(proto+'//'+location.host+'/__dev/ws');` +
  `ws.onmessage=function(e){` +
  `var d=e.data;` +
  `if(d==='reload'){location.reload();return;}` +
  `if(d.indexOf('version:')===0){` +
  `var v=d.slice(8);` +
  `if(!v)return;` +
  `if(build===null)build=v;` +
  `else if(build!==v)location.reload();` +
  `}};` +
  `ws.onclose=function(){setTimeout(connect,1000);};` +
  `}connect();})();`;
