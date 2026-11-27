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
 *   • `build-error:<json lines>` — the last frontend build failed. The server goes
 *     on serving the last bundle that built, so the tab draws the error over the
 *     page; `build-ok` (or the `reload` a good build sends) takes it away. A tab
 *     that connects while the build is broken is told at once.
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
export const _DEV_RELOAD_SCRIPT_PATH = "/__dev/reload.js";

/**
 * The tag `DevReloadMiddleware` injects into dev HTML responses, and Inertia bakes
 * into its cached template so streamed pages need no body rewrite.
 *
 * @internal
 */
export const DEV_RELOAD_CLIENT: string = `<script src="${_DEV_RELOAD_SCRIPT_PATH}"></script>`;

/**
 * The script served at {@link _DEV_RELOAD_SCRIPT_PATH}.
 *
 * @internal
 */
export const _DEV_RELOAD_SOURCE: string =
  `(function(){` +
  `var proto=location.protocol==='https:'?'wss:':'ws:';` +
  `var build=null;` +
  // The build-error overlay. Drawn with DOM calls and CSSOM properties only: no markup string,
  // no inline style attribute and no inline script, so a strict Content-Security-Policy that
  // allows this file allows the overlay too.
  `var overlay=null;` +
  `function hide(){if(overlay){overlay.remove();overlay=null;}}` +
  `function el(tag,text,style){var e=document.createElement(tag);if(text)e.textContent=text;` +
  `for(var k in style)e.style[k]=style[k];return e;}` +
  `function show(lines){hide();` +
  `var o=el('div','',{position:'fixed',top:'0',right:'0',bottom:'0',left:'0',zIndex:'2147483647',` +
  `overflow:'auto',padding:'32px',background:'rgba(17,17,23,0.94)',color:'#f4f4f5',` +
  `font:'13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',textAlign:'left'});` +
  `o.id='__zerotal_build_error';o.setAttribute('role','alertdialog');` +
  `o.setAttribute('aria-label','Build failed');` +
  `o.appendChild(el('div','Build failed',{color:'#f87171',fontSize:'16px',fontWeight:'700',marginBottom:'4px'}));` +
  `o.appendChild(el('div','The page underneath is the last build that worked.',{color:'#a1a1aa',marginBottom:'16px'}));` +
  `o.appendChild(el('pre',lines.join('\\n'),{whiteSpace:'pre-wrap',wordBreak:'break-word',margin:'0',` +
  `padding:'16px',borderRadius:'6px',background:'rgba(255,255,255,0.06)',font:'inherit'}));` +
  `o.appendChild(el('div','Fix it and save: the page reloads by itself. Esc hides this.',{color:'#a1a1aa',marginTop:'16px'}));` +
  `(document.body||document.documentElement).appendChild(o);overlay=o;}` +
  `document.addEventListener('keydown',function(e){if(e.key==='Escape')hide();});` +
  // Reconnect fast, then back off: a restarted server answers well inside a second, and a fixed
  // one-second wait was most of the time between a backend save and the page reloading.
  `var delay=100;function connect(){` +
  `var ws=new WebSocket(proto+'//'+location.host+'/__dev/ws');` +
  `ws.onmessage=function(e){` +
  `var d=e.data;` +
  `if(d==='reload'){location.reload();return;}` +
  `if(d==='build-ok'){hide();return;}` +
  `if(d.indexOf('build-error:')===0){try{show(JSON.parse(d.slice(12)));}catch(_){}return;}` +
  `if(d.indexOf('version:')===0){` +
  `var v=d.slice(8);` +
  `if(!v)return;` +
  `if(build===null)build=v;` +
  `else if(build!==v)location.reload();` +
  `}};` +
  `ws.onopen=function(){delay=100;};ws.onclose=function(){setTimeout(connect,delay);delay=Math.min(delay*2,1000);};` +
  `}connect();})();`;
