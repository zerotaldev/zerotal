/**
 * Browser-side helpers for the rich block editor, installed once per page load.
 *
 * Dependency-free on purpose — no CDN editor — mirroring what `@zerotal/admin`
 * does for its rich-text field.
 *
 * Everything here is **delegated from `document`**, and the script lives in the
 * layout rather than beside the editor: a `<script>` inserted by Flow's DOM morph
 * never executes, so per-element init would silently do nothing for an editor
 * opened by an action. Delegation covers elements created at any time.
 *
 * The contract with the markup:
 *
 *  - `[data-rich]`             — the contenteditable surface. Its `flow:ignore`
 *                                keeps the morph out of the subtree the caret is
 *                                in; the server renders its initial HTML.
 *  - `data-rich-field="<id>"`  — the hidden, Flow-modeled `<textarea>` that
 *                                carries the HTML to the server.
 *  - `data-rich-focus`         — focus this editor when it appears.
 */
export const RICH_EDITOR_SCRIPT = `
(function(){
  if (window.__ztRichInit) return; window.__ztRichInit = 1;

  function fieldFor(ed){
    var id = ed.getAttribute('data-rich-field');
    return id ? document.getElementById(id) : null;
  }

  // Push the editor's HTML into its Flow-modeled field. The bubbling 'input'
  // event is what Flow's flow:model listener already consumes, so a rich edit
  // reaches the server exactly like a typed field — no new transport.
  function push(ed){
    var field = fieldFor(ed);
    if (!field) return;
    field.value = ed.innerHTML;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  document.addEventListener('input', function(ev){
    var ed = ev.target && ev.target.closest && ev.target.closest('[data-rich]');
    if (ed) push(ed);
  });

  document.addEventListener('focusout', function(ev){
    var ed = ev.target && ev.target.closest && ev.target.closest('[data-rich]');
    if (ed) push(ed);
  }, true);

  // Enter splits the paragraph instead of inserting a bare <br>, so the block
  // structure the server serialises matches what the writer sees.
  document.addEventListener('keydown', function(ev){
    var ed = ev.target && ev.target.closest && ev.target.closest('[data-rich]');
    if (!ed || ev.key !== 'Enter' || ev.shiftKey) return;
    ev.preventDefault();
    document.execCommand('insertParagraph', false, null);
    push(ed);
  });

  // Focus an editor the moment it is inserted by a patch. autofocus is not
  // honoured for contenteditable, and there is no post-morph hook to hang this on.
  function focusNew(root){
    var ed = root.matches && root.matches('[data-rich][data-rich-focus]')
      ? root
      : (root.querySelector && root.querySelector('[data-rich][data-rich-focus]'));
    if (!ed || ed.__ztFocused) return;
    ed.__ztFocused = 1;
    ed.focus();
    // Caret to the end, so typing continues the sentence rather than preceding it.
    try {
      var range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) { /* selection unavailable — focus alone is enough */ }
  }

  new MutationObserver(function(records){
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        if (added[j].nodeType === 1) focusNew(added[j]);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Toolbar. execCommand is deprecated but universally implemented, and is the
  // only way to get native undo, selection handling and IME behaviour for free.
  window.__ztCmd = function(cmd, value){
    var ed = document.querySelector('[data-rich]');
    try {
      if (cmd === 'createLink') {
        var href = window.prompt('Link to:');
        if (!href) return;
        document.execCommand('createLink', false, href);
      } else {
        document.execCommand(cmd, false, value || null);
      }
    } catch (e) { /* unsupported command — leave the text alone */ }
    if (ed) push(ed);
  };
})();
`.trim();
