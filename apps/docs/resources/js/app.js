// resources/js/app.js
// Built by FlowProvider at boot: resources/ → public/

// ── Syntax highlighting ───────────────────────────────────────────────────────
import Prism from "prismjs";
// Import in dependency order so Prism.languages.extend() finds its parent.
import "prismjs/components/prism-typescript"; // extends javascript (auto-loaded)
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markup"; // html / xml
import "prismjs/components/prism-css"; // extends markup
import "prismjs/components/prism-jsx"; // extends markup + javascript
import "prismjs/components/prism-tsx"; // extends typescript + jsx
import "prismjs/components/prism-ini";
import "prismjs/components/prism-powershell";

// ── Per-page init ─────────────────────────────────────────────────────────────
// Called on first load AND after every SPA navigation (Decision 4).
// Order: copy buttons → heading anchors → active link → highlight → ToC.

let _tocObserver = null;
let _currentPath = location.pathname;

// STEP 1 — Copy button (Decision 1) ──────────────────────────────────────────
function injectCopyButtons() {
  document.querySelectorAll("article pre").forEach((pre) => {
    if (pre.querySelector(".copy-btn")) return; // already injected on this pre
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.addEventListener("click", async () => {
      const code = pre.querySelector("code");
      const text = (code ?? pre).textContent ?? "";
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied!";
        btn.classList.add("copy-btn--success");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copy-btn--success");
        }, 2000);
      } catch {
        // Clipboard API unavailable (non-secure context, denied permission).
      }
    });
    pre.appendChild(btn);
  });
}

// STEP 2 — Heading anchor links (Decision 2) ─────────────────────────────────
function injectHeadingAnchors() {
  document.querySelectorAll("article h2[id], article h3[id]").forEach((h) => {
    if (h.querySelector(".heading-anchor")) return; // already injected
    const a = document.createElement("a");
    a.href = "#" + h.id;
    a.className = "heading-anchor";
    a.setAttribute("aria-label", "Link to this section");
    a.textContent = "#";
    h.appendChild(a);
  });
}

// ── Collapsible nav groups + nested parent sections ──────────────────────────
// Two independent levels share the same open/closed pattern: top-level groups
// (.nav-group / [data-group-items]) and, nested inside them, parent items that
// have their own children (.nav-parent / [data-child-items], e.g. "Admin
// Panel" over "Resources", "Tables", …).
const NAV_LEVELS = [
  {
    item: ".nav-group",
    content: "[data-group-items]",
    btn: ".nav-group-btn",
    chevron: ".nav-group-chevron",
  },
  {
    item: ".nav-parent",
    content: "[data-child-items]",
    btn: ".nav-child-btn",
    chevron: ".nav-child-chevron",
  },
];

function syncGroupCollapse(pathname) {
  _currentPath = pathname;
  for (const { item, content, btn, chevron } of NAV_LEVELS) {
    document.querySelectorAll(`#nav-list ${item}`).forEach((li) => {
      const items = li.querySelector(content);
      const chev = li.querySelector(chevron);
      if (!items) return;
      // Buttonless groups (the API reference tree) aren't collapsible — always open.
      if (!li.querySelector(btn)) {
        items.classList.remove("hidden");
        return;
      }
      // Checked against the whole item (not just `content`) so a parent whose
      // own link is the active page — not one of its children — still expands.
      const hasActive = Array.from(li.querySelectorAll("a[href]")).some((a) => {
        const href = a.getAttribute("href") ?? "";
        return href === pathname || href === pathname + "/";
      });
      items.classList.toggle("hidden", !hasActive);
      chev?.classList.toggle("-rotate-90", !hasActive);
    });
  }
}

// STEP 4 — Active sidebar link (Decision 7) ──────────────────────────────────
// Sets aria-current="page" on the sidebar link matching the current pathname.
// Runs on first load and after every SPA navigation so the attribute is always
// in sync — CSS in app.css targets [aria-current="page"] for the visual style.
function setActiveLink(path = location.pathname) {
  document.querySelectorAll("#sidebar a[href]").forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    const active = href === path || href === path + "/";
    if (active) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  });
}

// ── Syntax highlighting ───────────────────────────────────────────────────────
function highlightCode() {
  // Bun.markdown puts language-* on <code>; Prism targets pre[class*="language-"].
  document.querySelectorAll('pre > code[class*="language-"]').forEach((code) => {
    const lang = [...code.classList].find((c) => c.startsWith("language-"));
    if (lang && !code.parentElement.classList.contains(lang)) {
      code.parentElement.classList.add(lang);
    }
  });
  Prism.highlightAll();
}

// ── Right-hand Table of Contents ─────────────────────────────────────────────
function buildToc() {
  // Disconnect stale observer so it isn't tracking headings from the previous page.
  if (_tocObserver) {
    _tocObserver.disconnect();
    _tocObserver = null;
  }

  // Collect h2 (top level) and h3 (nested children) in document order.
  const headings = Array.from(document.querySelectorAll("article h2, article h3"));
  const toc = document.getElementById("toc");
  const tocNav = document.getElementById("toc-nav");
  if (!toc || !tocNav) return;

  tocNav.innerHTML = "";
  if (headings.length < 2) {
    toc.className = "hidden";
    return;
  }

  // Restore the classes stashed in data-toc-classes (set in server HTML).
  toc.className = toc.dataset.tocClasses || "";

  // Shared base; h3 links are indented and slightly smaller so the
  // h2 → h3 hierarchy reads as a nested tree. Links sit on the rail drawn by
  // #toc-nav and carry their own transparent left border — the same
  // accent-segment treatment the sidebar uses, so both gutters read alike.
  const TOC_BASE =
    "toc-link block -ml-px border-l border-transparent transition-colors leading-snug no-underline hover:text-stone-800";
  const TOC_H2 = `${TOC_BASE} pl-3 pr-2 py-1 text-[0.8rem] text-stone-500`;
  const TOC_H3 = `${TOC_BASE} pl-6 pr-2 py-0.5 text-[0.78rem] text-stone-400`;

  headings.forEach((h, i) => {
    const level = h.tagName.toLowerCase(); // "h2" | "h3"
    if (!h.id) h.id = `${level}-${i}`;
    const a = document.createElement("a");
    a.href = "#" + h.id;
    a.textContent = Array.from(h.childNodes)
      .filter((n) => !(n.nodeType === Node.ELEMENT_NODE && n.classList.contains("heading-anchor")))
      .map((n) => n.textContent)
      .join("")
      .trim();
    a.className = level === "h3" ? TOC_H3 : TOC_H2;
    a.dataset.target = h.id;
    a.dataset.level = level;
    tocNav.appendChild(a);
  });

  function setTocActive(id) {
    tocNav.querySelectorAll(".toc-link").forEach((l) => {
      const on = l.dataset.target === id;
      const base = l.dataset.level === "h2" ? "text-stone-500" : "text-stone-400";
      l.classList.toggle("text-voltage-700", on);
      l.classList.toggle("font-medium", on);
      // The border colours must swap rather than stack: Tailwind resolves
      // border-transparent vs border-voltage-700 by stylesheet order, not by the
      // order classes land on the element.
      l.classList.toggle("border-voltage-700", on);
      l.classList.toggle("border-transparent", !on);
      // Drop the resting colour while active so it doesn't fight text-voltage-700.
      l.classList.toggle(base, !on);
    });
  }

  _tocObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting);
      if (visible.length) setTocActive(visible[0].target.id);
    },
    { rootMargin: "-10% 0px -80% 0px" },
  );
  headings.forEach((h) => _tocObserver.observe(h));
}

// Keeps the sidebar's scroll position anchored to the current page rather
// than wherever it happened to land after the sidebar was rebuilt: back/forward
// navigation re-collapses and re-expands groups based on the new active path,
// which shifts every item below it — without this, that shift reads as the
// sidebar scroll "resetting" instead of following you to the new page.
function scrollActiveNavIntoView() {
  document
    .querySelector('#sidebar a[aria-current="page"]')
    ?.scrollIntoView({ block: "nearest", behavior: "instant" });
}

// ── initPage — canonical per-page hook ───────────────────────────────────────
// Decision 4: every feature that touches page content lives here.
// Call order: copy buttons → heading anchors → active link → collapse state →
// scroll it into view → highlight → ToC.
function initPage(path = location.pathname) {
  injectCopyButtons();
  injectHeadingAnchors();
  setActiveLink(path);
  syncGroupCollapse(path);
  scrollActiveNavIntoView();
  highlightCode();
  buildToc();
}

// ── Mobile sidebar toggle ─────────────────────────────────────────────────────
// The button lives in the persistent <header> — wired once.
// Sidebar is looked up lazily: it may be removed/re-injected by the navigator.
{
  const btn = document.getElementById("mobile-menu-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      document.getElementById("sidebar")?.classList.toggle("hidden");
    });
  }
}

// ── Nav group / parent collapse / expand ──────────────────────────────────────
document.addEventListener("click", (e) => {
  for (const { item, content, btn: btnSelector, chevron } of NAV_LEVELS) {
    const btn = e.target.closest(btnSelector);
    if (!btn) continue;
    const li = btn.closest(item);
    const items = li?.querySelector(content);
    const chev = btn.querySelector(chevron);
    if (!items) return;
    const isOpen = !items.classList.contains("hidden");
    items.classList.toggle("hidden", isOpen);
    chev?.classList.toggle("-rotate-90", isOpen);
    return;
  }
});

// ── Sidebar live search / filter ──────────────────────────────────────────────
// Delegated to document so it keeps working when sidebar is dynamically
// injected during SPA navigation (home → docs re-adds #sidebar to the DOM).
document.addEventListener("input", (e) => {
  if (e.target?.id !== "sidebar-search") return;
  const q = e.target.value.trim().toLowerCase();
  const searching = q.length > 0;
  let anyVisible = false;

  document.querySelectorAll("#nav-list .nav-group").forEach((group) => {
    let groupHit = false;
    group.querySelectorAll(".nav-item").forEach((item) => {
      const match = !q || (item.dataset.label ?? "").includes(q);
      item.classList.toggle("hidden", !match);
      if (match) groupHit = true;
    });

    // A parent whose own label misses but whose child list has a hit (e.g.
    // searching "resources" under "Admin Panel") stays visible, showing only
    // the matching children instead of disappearing with the parent.
    group.querySelectorAll(".nav-parent").forEach((parent) => {
      const childList = parent.querySelector("[data-child-items]");
      const anyChildVisible = Array.from(childList?.children ?? []).some(
        (c) => !c.classList.contains("hidden"),
      );
      if (!anyChildVisible) return;
      parent.classList.remove("hidden");
      groupHit = true;
      if (searching) {
        childList.classList.remove("hidden");
        parent.querySelector(".nav-child-chevron")?.classList.remove("-rotate-90");
      }
    });

    group.classList.toggle("hidden", !groupHit);
    if (groupHit) anyVisible = true;

    // Expand groups that have hits while searching
    if (searching && groupHit) {
      group.querySelector("[data-group-items]")?.classList.remove("hidden");
      group.querySelector(".nav-group-chevron")?.classList.remove("-rotate-90");
    }
  });

  // When search is cleared, restore the normal collapse state
  if (!searching) syncGroupCollapse(_currentPath);

  document.getElementById("search-empty")?.classList.toggle("hidden", anyVisible);
});

// STEP 3 — Keyboard shortcut (Decision 3) ────────────────────────────────────
// Press / (forward slash) when focus is outside any text input to jump to the
// sidebar search. Wired once on DOMContentLoaded — NOT inside initPage().
document.addEventListener("keydown", (e) => {
  if (e.key !== "/") return;
  const t = e.target;
  // Do not intercept / when the user is already typing in a field.
  if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
  const input = document.getElementById("sidebar-search");
  if (!input) return;
  e.preventDefault();
  input.focus();
  input.select();
});

// ── SPA Navigate ──────────────────────────────────────────────────────────────
// Intercepts clicks on internal <a> elements and swaps page content without a
// full reload, giving the docs site a SPA feel.
//
// External links (different origin, mailto:, tel:, download, _blank, modifier
// keys) are left alone and fall through to the browser's default handler.
//
// Layout transitions (home ↔ docs) are handled by inserting or removing the
// #sidebar and #toc elements so the shell structure is always correct.
//
// Hover prefetch: starts fetching the target page 150 ms after the cursor
// settles on a link so most navigations feel instant.
{
  const ORIGIN = location.origin;

  /** Successful responses only — keyed by absolute URL string. */
  const cache = new Map();

  /** In-flight fetch promises — prevents duplicate requests during prefetch. */
  const inflight = new Map();

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function isInternal(href) {
    if (!href) return false;
    if (href.startsWith("#")) return false; // anchor-only → browser handles scroll
    if (href.startsWith("mailto:")) return false;
    if (href.startsWith("tel:")) return false;
    try {
      return new URL(href, ORIGIN).origin === ORIGIN;
    } catch {
      return false;
    }
  }

  function shouldIntercept(anchor, event) {
    if (!isInternal(anchor.getAttribute("href"))) return false;
    if (anchor.hasAttribute("download")) return false;
    if (anchor.target && anchor.target !== "_self") return false;
    // Ctrl/Cmd/Shift/Alt + click → open in new tab / OS default.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    return true;
  }

  // ── Fetch ────────────────────────────────────────────────────────────────────

  // Resolves to `{ html, url }` where `url` is the *final* URL after any server
  // redirect (e.g. `/docs/api` → `/docs/api/README`), or `null` on network
  // failure. Callers must adopt the final URL so the document location matches
  // the content and relative links resolve correctly.
  function loadPage(url) {
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    if (inflight.has(url)) return inflight.get(url);

    const p = fetch(url, { headers: { Accept: "text/html" }, credentials: "same-origin" })
      .then(async (r) => {
        const result = { html: await r.text(), url: r.url || url };
        // Only cache successful responses — 404s render inline but aren't stored stale.
        if (r.ok) cache.set(url, result);
        inflight.delete(url);
        return result;
      })
      .catch(() => {
        inflight.delete(url);
        return null;
      });

    inflight.set(url, p);
    return p;
  }

  // ── DOM swap ─────────────────────────────────────────────────────────────────

  function swapPage(html, url) {
    const incoming = new DOMParser().parseFromString(html, "text/html");
    const pathname = new URL(url, ORIGIN).pathname;

    // Title
    document.title = incoming.title;

    // ── <header> ─────────────────────────────────────────────────────────────
    // Swap when transitioning between landing (marketing nav) and docs (minimal nav).
    const newHeader = incoming.querySelector("header");
    const curHeader = document.querySelector("header");
    if (newHeader && curHeader && newHeader.outerHTML !== curHeader.outerHTML) {
      curHeader.replaceWith(document.importNode(newHeader, true));
    }

    // ── <main> ────────────────────────────────────────────────────────────────
    // className carries the sidebar offset (md:ml-72) vs full-width distinction.
    const newMain = incoming.querySelector("main");
    const curMain = document.querySelector("main");
    if (newMain && curMain) {
      curMain.className = newMain.className;
      curMain.innerHTML = newMain.innerHTML;
    }

    // ── Sidebar ───────────────────────────────────────────────────────────────
    const newSidebar = incoming.getElementById("sidebar");
    const curSidebar = document.getElementById("sidebar");

    if (newSidebar && !curSidebar) {
      // home → docs: sidebar was never in DOM — import and insert before <main>.
      curMain?.before(document.importNode(newSidebar, true));
    } else if (!newSidebar && curSidebar) {
      // docs → home: remove sidebar entirely so layout is clean.
      curSidebar.remove();
    } else if (newSidebar && curSidebar && newSidebar.innerHTML !== curSidebar.innerHTML) {
      // docs → docs: the sidebar body differs between the guide nav and the API
      // reference tree (and between API packages), so swap its content in. The
      // collapse/filter handlers are delegated on document, so no rebinding.
      curSidebar.innerHTML = newSidebar.innerHTML;
    }

    // ── ToC ───────────────────────────────────────────────────────────────────
    const newToc = incoming.getElementById("toc");
    const curToc = document.getElementById("toc");

    if (newToc && !curToc) {
      // home → docs: inject the ToC shell; buildToc() will populate and reveal it.
      const shell = document.importNode(newToc, true);
      shell.className = "hidden";
      curMain?.after(shell);
    } else if (!newToc && curToc) {
      // docs → home: remove it.
      curToc.remove();
    } else if (newToc && curToc) {
      // docs → docs: reset inner structure so buildToc() starts clean.
      curToc.className = "hidden";
      curToc.innerHTML = newToc.innerHTML;
    }

    // ── Finish ────────────────────────────────────────────────────────────────
    // The sidebar branch above already swapped in server-rendered HTML with the
    // right active classes baked in (or left it untouched because it was
    // already identical) — there's nothing left for JS to patch here.
    window.scrollTo({ top: 0, behavior: "instant" });
    initPage(pathname);
  }

  // ── Navigate ─────────────────────────────────────────────────────────────────

  let _navigating = false;

  async function navigate(url, push = true) {
    if (_navigating) return;
    const fullUrl = new URL(url, ORIGIN).href;
    if (push && fullUrl === location.href) return; // already here

    _navigating = true;
    document.documentElement.setAttribute("data-navigating", "");

    try {
      const result = await loadPage(fullUrl);
      if (result === null) {
        location.href = url;
        return;
      } // network failure → full load
      // Adopt the post-redirect URL so relative links resolve against it.
      const finalUrl = result.url;
      swapPage(result.html, finalUrl);
      if (push) history.pushState({ docsNavigate: true, url: finalUrl }, "", finalUrl);
    } catch {
      location.href = url;
    } finally {
      _navigating = false;
      document.documentElement.removeAttribute("data-navigating");
    }
  }

  // ── Click delegation ──────────────────────────────────────────────────────────

  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a[href]");
    if (!anchor || !shouldIntercept(anchor, e)) return;
    e.preventDefault();
    // Use the DOM-resolved absolute URL, not the raw attribute: relative links
    // (e.g. the API reference's `@zerotal/core/README`) must resolve against
    // the current document, not the site origin.
    navigate(anchor.href);
  });

  // ── Hover prefetch ────────────────────────────────────────────────────────────

  let _prefetchTimer;

  document.addEventListener("mouseover", (e) => {
    const anchor = e.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!isInternal(href)) return;
    clearTimeout(_prefetchTimer);
    _prefetchTimer = setTimeout(() => {
      // Resolve against the current document (anchor.href), not the origin, so
      // relative links prefetch the same URL navigate() will request.
      const url = anchor.href;
      if (!cache.has(url) && !inflight.has(url)) loadPage(url);
    }, 150);
  });

  document.addEventListener("mouseout", () => clearTimeout(_prefetchTimer));

  // ── Back / forward ────────────────────────────────────────────────────────────

  window.addEventListener("popstate", (e) => {
    if (e.state?.docsNavigate) navigate(location.href, false);
  });

  // Stamp the initial entry so the first back-button press fires popstate.
  history.replaceState({ docsNavigate: true, url: location.href }, "", location.href);
}

// ── Run on first load ─────────────────────────────────────────────────────────
initPage();

// ── DevTools ──────────────────────────────────────────────────────────────────
// The panel the framework ships, running against the framework's own docs site.
// The server half is gated on the environment, so in production the endpoints
// are absent and this connects to nothing. Alt+D toggles it.
import { DevTools } from "@zerotal/devtools/client";
DevTools.start();
