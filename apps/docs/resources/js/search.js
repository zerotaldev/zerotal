// ── Header search ─────────────────────────────────────────────────────────────
//
// One field in the top bar, one dropdown card, two kinds of answer.
//
// The sidebar filter this replaces could only hide navigation rows, so it could
// only find a page whose name you already knew — typing "inertia" produced "No
// matching pages" while the Inertia section sat in the nav behind it. The card
// shows page-name matches *and* content matches from `/api/docs-search`, and it
// is in the header, so it works on pages that have no sidebar at all.
//
// Delegated from `document` throughout: SPA navigation replaces the header, and a
// listener bound to the element would be pointing at a detached node afterwards.

const DEBOUNCE_MS = 180;

let timer = null;
let seq = 0;
/** Flat list of the rendered rows, for arrow-key movement. */
let rows = [];
let active = -1;

const panel = () => document.getElementById("site-search-panel");
const input = () => document.getElementById("site-search-input");

function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function close() {
  const p = panel();
  if (p) {
    p.classList.add("hidden");
    p.innerHTML = "";
  }
  input()?.setAttribute("aria-expanded", "false");
  rows = [];
  active = -1;
}

/** Highlight the row at `index`, wrapping at both ends. */
function move(delta) {
  if (rows.length === 0) return;
  active = (active + delta + rows.length) % rows.length;
  rows.forEach((row, i) => {
    row.classList.toggle("bg-stone-100", i === active);
    if (i === active) row.scrollIntoView({ block: "nearest" });
  });
}

const GROUP_LABEL =
  "px-2 pt-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-stone-400";
const ROW =
  "search-row block rounded-lg px-2.5 py-2 no-underline hover:bg-stone-100 transition-colors";

function render({ pages = [], results = [] }) {
  const p = panel();
  if (!p) return;

  if (pages.length === 0 && results.length === 0) {
    p.innerHTML = `<p class="px-2.5 py-3 text-[0.8125rem] text-stone-400">Nothing matched.</p>`;
    p.classList.remove("hidden");
    input()?.setAttribute("aria-expanded", "true");
    rows = [];
    active = -1;
    return;
  }

  const href = (slug) => (slug.startsWith("/") ? slug : `/docs/${slug}`);

  const pageRows = pages
    .map(
      (r) => `
      <a href="${esc(href(r.slug))}" class="${ROW}">
        <span class="block text-[0.8125rem] font-medium text-stone-900">${esc(r.label)}</span>
        <span class="block text-[0.75rem] text-stone-400">${esc(r.group)}</span>
      </a>`,
    )
    .join("");

  const contentRows = results
    .map(
      (r) => `
      <a href="${esc(href(r.slug))}" class="${ROW}">
        <span class="block text-[0.8125rem] font-medium text-stone-900">${esc(r.title)}</span>
        ${r.heading ? `<span class="block text-[0.75rem] text-stone-500">${esc(r.heading)}</span>` : ""}
      </a>`,
    )
    .join("");

  p.innerHTML =
    (pages.length ? `<p class="${GROUP_LABEL}">Pages</p>${pageRows}` : "") +
    (results.length ? `<p class="${GROUP_LABEL}">In the documentation</p>${contentRows}` : "");

  p.classList.remove("hidden");
  input()?.setAttribute("aria-expanded", "true");
  rows = Array.from(p.querySelectorAll(".search-row"));
  active = -1;
}

async function run(query) {
  // Out-of-order responses are the classic type-ahead bug: a slow "in" landing
  // after a fast "inertia" replaces good results with worse ones.
  const mine = ++seq;

  let payload;
  try {
    const res = await fetch(`/api/docs-search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return;
    payload = await res.json();
  } catch {
    return; // Offline, or navigated away mid-request.
  }

  if (mine !== seq) return;
  render(payload);
}

function schedule(query) {
  clearTimeout(timer);
  if (query.length < 1) {
    close();
    return;
  }
  timer = setTimeout(() => void run(query), DEBOUNCE_MS);
}

document.addEventListener("input", (e) => {
  if (e.target?.id !== "site-search-input") return;
  schedule(e.target.value.trim());
});

document.addEventListener("keydown", (e) => {
  // `/` focuses the field from anywhere, unless the caret is already in one.
  if (e.key === "/") {
    const t = e.target;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
    const box = input();
    if (!box) return;
    e.preventDefault();
    box.focus();
    box.select();
    return;
  }

  if (e.target?.id !== "site-search-input") return;

  if (e.key === "Escape") {
    close();
    e.target.blur();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    move(1);
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    move(-1);
    return;
  }
  if (e.key === "Enter" && active >= 0) {
    e.preventDefault();
    rows[active]?.click();
  }
});

// Clicking a result navigates, and the card has to go with it — the SPA router
// swaps the page without a reload, so nothing else would close it.
document.addEventListener("click", (e) => {
  if (e.target?.closest?.("#site-search")) {
    if (e.target.closest(".search-row")) close();
    return;
  }
  close();
});
