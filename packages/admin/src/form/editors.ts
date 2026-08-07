/**
 * Tiny client helpers for the editor field types, injected once per form page
 * (guarded so it defines its globals only once). They are intentionally
 * dependency-free — no CDN editor — so they survive Flow's DOM morph:
 *
 *  - `__kTab`       — tab-to-indent inside the code textarea.
 *  - `__kMd`        — wrap the markdown textarea selection (bold/italic/link…).
 *  - `__kRich`      — bind a contenteditable to a hidden, Flow-modeled textarea
 *                     (writes innerHTML back + dispatches `input` so the server syncs).
 *  - `__kRichCmd`   — `document.execCommand` for the rich toolbar.
 *
 * Each writes to the bound field and dispatches a bubbling `input` event, which is
 * exactly what Flow's `flow:model` listener consumes — so editor edits round-trip
 * to the server like any other field.
 */
export const EDITOR_SCRIPT = `
(function(){
  if (window.__kEditors) return; window.__kEditors = 1;
  function sync(el){ el.dispatchEvent(new Event('input', { bubbles: true })); }
  window.__kTab = function(ev, id){
    if (ev.key !== 'Tab') return; ev.preventDefault();
    var ta = document.getElementById(id); if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + 2; sync(ta);
  };
  window.__kMd = function(id, before, after){
    var ta = document.getElementById(id); if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    ta.value = v.slice(0, s) + before + v.slice(s, e) + after + v.slice(e);
    sync(ta); ta.focus();
    ta.selectionStart = s + before.length; ta.selectionEnd = e + before.length;
  };
  window.__kRich = function(edId, hId){
    var ed = document.getElementById(edId), h = document.getElementById(hId);
    if (!ed || !h || ed.__k) return; ed.__k = 1;
    if (document.activeElement !== ed) ed.innerHTML = h.value || '';
    ed.addEventListener('input', function(){ h.value = ed.innerHTML; sync(h); });
    ed.addEventListener('blur', function(){ h.value = ed.innerHTML; sync(h); });
  };
  window.__kRichCmd = function(cmd){ try { document.execCommand(cmd, false, null); } catch (e) {} };
})();
`.trim();
