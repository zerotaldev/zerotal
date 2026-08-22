// ── Site search ───────────────────────────────────────────────────────────────
//
// One field, one dropdown card, two kinds of answer.
//
// The sidebar filter this replaces could only hide navigation rows, so it could
// only find a page whose name you already knew — typing "inertia" produced "No
// matching pages" while the Inertia section sat in the nav behind it. The card
// shows page-name matches *and* content matches from `/api/docs-search`.
//
// There are two instances on the page: the header field, and one inside the
// mobile menu, where the header has no room for a text box. Nothing here is
// addressed by id for that reason — an instance is a `[data-search]` container,
// and every lookup walks up from the focused input to find its own panel. Adding
// a third would need no change here.
//
// Delegated from `document` throughout: SPA navigation replaces the header, and a
// listener bound to the element would be pointing at a detached node afterwards.

const DEBOUNCE_MS = 180;

/** Per-instance state, keyed by the container element. */
const state = new WeakMap();

function instanceOf(input) {
  const root = input?.closest?.("[data-search]");
  if (!root) return null;
  let st = state.get(root);
  if (!st) {
    st = { root, timer: null, seq: 0, rows: [], active: -1 };
    state.set(root, st);
  }
  return st;
}

const inputOf = (st) => st.root.querySelector("[data-search-input]");
const panelOf = (st) => st.root.querySelector("[data-search-panel]");
const statusOf = (st) => st.root.querySelector("[data-search-status]");

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/**
 * Escaped text with every occurrence of `query`'s terms wrapped in `<mark>`.
 *
 * Escaping happens first and the marks go in afterwards, so a page title
 * containing `<script>` stays inert — the offsets are computed against the
 * escaped string, never the raw one.
 */
function highlight(text, query) {
  const safe = esc(text);
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return safe;
  return safe.replace(
    new RegExp(`(${terms.join("|")})`, "gi"),
    '<mark class="bg-voltage-100 text-ink rounded-sm px-0.5">$1</mark>',
  );
}

function close(st) {
  const panel = panelOf(st);
  if (panel) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
  }
  const input = inputOf(st);
  input?.setAttribute("aria-expanded", "false");
  input?.removeAttribute("aria-activedescendant");
  const status = statusOf(st);
  if (status) status.textContent = "";
  st.rows = [];
  st.active = -1;
}

/**
 * Highlight the row at `index`, wrapping at both ends.
 *
 * `aria-activedescendant` is what makes this arrow key do anything for a screen
 * reader: focus stays in the text field — it has to, or typing would stop — so
 * the only way to announce a moving selection is to name the option the field is
 * currently pointing at. Without it the rows were plain links and the arrows
 * moved a background colour nobody was told about.
 */
function move(st, delta) {
  if (st.rows.length === 0) return;
  st.active = (st.active + delta + st.rows.length) % st.rows.length;
  st.rows.forEach((row, i) => {
    const on = i === st.active;
    row.classList.toggle("bg-stone-100", on);
    row.setAttribute("aria-selected", String(on));
    if (on) row.scrollIntoView({ block: "nearest" });
  });
  inputOf(st)?.setAttribute("aria-activedescendant", st.rows[st.active].id);
}

const GROUP_LABEL =
  "px-2 pt-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-stone-400";
const ROW =
  "search-row block rounded-lg px-2.5 py-2 no-underline hover:bg-stone-100 transition-colors";

function render(st, { pages = [], results = [] }, query) {
  const panel = panelOf(st);
  const input = inputOf(st);
  if (!panel || !input) return;

  const status = statusOf(st);
  const total = pages.length + results.length;

  if (total === 0) {
    panel.innerHTML = `<p class="px-2.5 py-3 text-[0.8125rem] text-stone-400">Nothing matched.</p>`;
    panel.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    input.removeAttribute("aria-activedescendant");
    if (status) status.textContent = "No results.";
    st.rows = [];
    st.active = -1;
    return;
  }

  const href = (slug) => (slug.startsWith("/") ? slug : `/docs/${slug}`);
  // Ids have to be unique across both instances, or `aria-activedescendant` in
  // the header could name a row inside the mobile menu.
  const prefix = `${input.id}-opt`;
  let n = 0;

  const pageRows = pages
    .map(
      (r) => `
      <a id="${prefix}-${n++}" role="option" aria-selected="false" href="${esc(href(r.slug))}" class="${ROW}">
        <span class="block text-[0.8125rem] font-medium text-stone-900">${highlight(r.label, query)}</span>
        <span class="block text-[0.75rem] text-stone-400">${esc(r.group)}</span>
      </a>`,
    )
    .join("");

  const contentRows = results
    .map(
      (r) => `
      <a id="${prefix}-${n++}" role="option" aria-selected="false" href="${esc(href(r.slug))}" class="${ROW}">
        <span class="block text-[0.8125rem] font-medium text-stone-900">${highlight(r.title, query)}</span>
        ${r.heading ? `<span class="block text-[0.75rem] text-stone-500">${highlight(r.heading, query)}</span>` : ""}
        <span class="block text-[0.6875rem] text-stone-400 font-mono mt-0.5">${esc(r.slug)}</span>
      </a>`,
    )
    .join("");

  panel.innerHTML =
    (pages.length ? `<p class="${GROUP_LABEL}">Pages</p>${pageRows}` : "") +
    (results.length ? `<p class="${GROUP_LABEL}">In the documentation</p>${contentRows}` : "");

  panel.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
  if (status) {
    status.textContent = `${total} result${total === 1 ? "" : "s"}. Use the arrow keys to review them.`;
  }
  st.rows = Array.from(panel.querySelectorAll(".search-row"));
  st.active = -1;
}

async function run(st, query) {
  // Out-of-order responses are the classic type-ahead bug: a slow "in" landing
  // after a fast "inertia" replaces good results with worse ones.
  const mine = ++st.seq;

  let payload;
  try {
    const res = await fetch(`/api/docs-search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    payload = await res.json();
  } catch {
    return; // Offline, or navigated away mid-request.
  }

  if (mine !== st.seq) return;
  render(st, payload, query);
}

function schedule(st, query) {
  clearTimeout(st.timer);
  if (query.length < 1) {
    close(st);
    return;
  }
  st.timer = setTimeout(() => void run(st, query), DEBOUNCE_MS);
}

document.addEventListener("input", (e) => {
  const st = instanceOf(e.target);
  if (!st || !e.target.matches("[data-search-input]")) return;
  schedule(st, e.target.value.trim());
});

document.addEventListener("keydown", (e) => {
  // `/` focuses the field from anywhere, unless the caret is already in one. The
  // header field is the target: on a viewport where it is hidden there is no
  // keyboard to press `/` on.
  if (e.key === "/") {
    const t = e.target;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    const box = document.getElementById("site-search-input");
    if (!box) return;
    e.preventDefault();
    box.focus();
    box.select();
    return;
  }

  if (!e.target?.matches?.("[data-search-input]")) return;
  const st = instanceOf(e.target);
  if (!st) return;

  if (e.key === "Escape") {
    close(st);
    e.target.blur();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    move(st, 1);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    move(st, -1);
    return;
  }
  if (e.key === "Home" && st.rows.length) {
    e.preventDefault();
    st.active = -1;
    move(st, 1);
    return;
  }
  if (e.key === "End" && st.rows.length) {
    e.preventDefault();
    st.active = 0;
    move(st, -1);
    return;
  }
  if (e.key === "Enter" && st.active >= 0) {
    e.preventDefault();
    st.rows[st.active]?.click();
  }
});

// Clicking a result navigates, and the card has to go with it — the SPA router
// swaps the page without a reload, so nothing else would close it. Clicking
// anywhere outside an instance closes every open one.
document.addEventListener("click", (e) => {
  const inside = e.target?.closest?.("[data-search]");
  document.querySelectorAll("[data-search]").forEach((root) => {
    const st = state.get(root);
    if (!st) return;
    if (root !== inside || e.target.closest(".search-row")) close(st);
  });
});
