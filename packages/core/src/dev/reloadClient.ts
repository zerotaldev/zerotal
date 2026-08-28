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
 * Exported as a string because it is injected inline: `DevReloadMiddleware`
 * rewrites HTML responses with it for every view layer, and Inertia bakes it
 * into its cached template so streamed pages need no body rewrite.
 *
 * @internal
 */
export const DEV_RELOAD_CLIENT: string =
  `<script>(function(){` +
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
  `}connect();})();</script>`;
