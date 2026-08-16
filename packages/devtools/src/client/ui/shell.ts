/**
 * The panel's frame: the bar, the tab strip, the content host, and every event
 * listener the panel owns.
 *
 * Listeners live on the three persistent containers — `#bar`, `#tabs`,
 * `#content` — and dispatch on `data-*` attributes, so a tab can replace its
 * markup wholesale without any of them needing to be reattached. That is the one
 * structural rule this file keeps: nothing below ever binds a listener to a node
 * a tab renders.
 */
import type { RequestTrace } from "../../RequestTrace.ts";
import { toggleFacet } from "../tabs/all.ts";
import { APP_TABS, invalidateMap } from "../tabs/app.ts";
import { channelTab } from "../tabs/channel.ts";
import type { TabContext, TabView } from "../tabs/types.ts";
import { ensureRegistry, type DevtoolsRegistry } from "../registry.ts";
import { MIN_HEIGHT, type Store } from "../state.ts";
import type { Transport } from "../transport.ts";
import { dCls, esc, fmt, scCls } from "./format.ts";
import { CSS, isLightTheme, THEME_CYCLE, THEME_ICON } from "./theme.ts";

export interface ShellOptions {
  base: string;
  standalone: boolean;
  mount: HTMLElement;
  store: Store;
  transport: Transport;
  /** The built-in tabs, in strip order. */
  tabs: TabView[];
}

/** How long a copy button shows that it worked. */
const COPY_FEEDBACK_MS = 900;

export function mountShell(opts: ShellOptions): void {
  const { base, standalone, store, transport, tabs } = opts;
  const registry = ensureRegistry();

  // ── DOM ─────────────────────────────────────────────────────────────────────
  const host = document.createElement("div");
  host.id = "__zerotal_dt__";
  host.style.cssText = standalone
    ? "position:fixed;inset:0;z-index:2147483647"
    : "position:fixed;bottom:0;left:0;right:0;z-index:2147483647;pointer-events:none";
  opts.mount.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    `${CSS}<div id="wrap" class="${standalone ? "standalone" : ""}" tabindex="-1" ` +
    `style="pointer-events:auto">` +
    `<div id="panel" style="display:${store.open ? "flex" : "none"}">` +
    `<div id="grip" title="Drag to resize"></div>` +
    `<div id="tabs"></div><div id="content"></div></div>` +
    `<div id="bar"></div></div>`;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => shadow.querySelector<T>(sel)!;

  const wrap = $("#wrap");
  const panel = $("#panel");
  const bar = $("#bar");
  const tabStrip = $("#tabs");
  const content = $("#content");

  // ── Tab table ───────────────────────────────────────────────────────────────
  //
  // Rebuilt per render because channels arrive over the wire and plugins register
  // whenever their own package is ready — the set is not known at start.

  /**
   * The tabs for the section showing.
   *
   * Channels and plugins belong to the request stream — they are per-request
   * data — so they only appear alongside it. The App section is a fixed six.
   */
  function allTabs(): TabView[] {
    if (store.section === "app") return APP_TABS;
    return [...tabs, ...store.channels.map(channelTab), ...registry.panels.map(pluginTab)];
  }

  function pluginTab(p: DevtoolsRegistry["panels"][number]): TabView {
    return {
      id: `plugin:${p.id}`,
      label: p.title,
      // A plugin owns its data and its DOM; the panel cannot know when either
      // moved, so it redraws whenever anything else did and on explicit refresh.
      volatile: true,
      standsAlone: true,
      badge: () => {
        const count = p.badge?.();
        return count ? { count } : undefined;
      },
      render(el) {
        try {
          p.render(el, { trace: store.selected });
        } catch {
          // A broken extension tab must not take the panel with it.
          el.innerHTML = '<p class="empty">Panel error</p>';
        }
      },
    };
  }

  function currentTab(): TabView | undefined {
    const list = allTabs();
    return list.find((t) => t.id === store.activeTab) ?? list[0];
  }

  function ctx(): TabContext {
    return { trace: store.selected, store };
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  /**
   * What the content host currently shows.
   *
   * A tab that reads one trace has nothing new to say until that trace changes,
   * so redrawing it on every arriving request only destroys the scroll position
   * and any open `<details>`. Volatile tabs opt out by folding the store's
   * revision into the key.
   */
  let contentKey = "";

  function render(): void {
    applyTheme();
    renderBar();
    if (!store.open) return;
    renderTabs();
    renderContent();
  }

  function applyTheme(): void {
    wrap.classList.toggle("light", isLightTheme(store.theme));
    if (!standalone) panel.style.height = `${store.height}px`;
    reserveSpace();
  }

  /**
   * Give the host page back the strip the panel covers.
   *
   * The panel is fixed to the bottom of the viewport, so without this the last
   * 32px of a page — or the panel's full height when open — is behind it and
   * cannot be scrolled to. The value is written as a custom property as well as
   * the padding, so an app that would rather move something else of its own can
   * read `--zt-dt-height` instead.
   */
  function reserveSpace(): void {
    if (standalone) return;
    const height = wrap.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--zt-dt-height", `${height}px`);
    document.body.style.paddingBottom = `${height}px`;
  }

  function renderBar(): void {
    const t = store.selected;
    const dot =
      `<span class="dot ${store.connected ? "ok" : "err"}" ` +
      `title="${store.connected ? "Connected" : "Disconnected"}">●</span>`;

    // Pinned and behind: an offer to catch up, never a jump. Nothing is more
    // hostile than a list that scrolls away from what you were reading.
    const catchUp =
      !store.live && store.pending
        ? `<button class="ibtn pending" data-action="live" ` +
          `title="Jump to the newest request">⤒ ${store.pending} new</button>`
        : "";
    const liveBtn = store.live
      ? `<button class="ibtn live-on" data-action="pin" title="Live — click to pin">⏵ Live</button>`
      : `<button class="ibtn" data-action="live" title="Pinned — click to follow newest">⏸ Pinned</button>`;
    const arrow = store.open ? "▼" : "▲";
    const theme =
      `<button class="ibtn" data-action="theme" ` +
      `title="Theme: ${store.theme}">${THEME_ICON[store.theme]}</button>`;

    // The dashboard has no page to collapse back to and no host page to be
    // removed from, so it drops the toggle, popout, and close controls.
    const chrome = standalone
      ? `<button class="ibtn" data-action="clear" title="Clear traces">🗑</button>${theme}`
      : `<button class="ibtn" data-action="clear" title="Clear traces">🗑</button>` +
        theme +
        `<button class="ibtn" data-action="dash"  title="Open inspector">⤢</button>` +
        `<button class="ibtn" data-action="close" title="Remove devtools">✕</button>` +
        `<button class="ibtn" data-action="toggle" title="Toggle panel (Alt+D)">${arrow}</button>`;

    if (!t) {
      bar.innerHTML =
        `<span class="logo">⬡ <b>Zerotal</b></span>${dot}<span class="sp"></span>` +
        `${catchUp}${liveBtn}${chrome}`;
      return;
    }

    const n1 = t.warnings.length ? `<span class="chip warn">⚠${t.warnings.length}</span>` : "";
    const user = t.auth
      ? `<span class="chip" title="${esc(String(t.auth.email ?? t.auth.id ?? ""))}">👤</span>`
      : "";
    const mail = t.mail?.length ? `<span class="chip">📧${t.mail.length}</span>` : "";
    const jobs = t.jobs?.length ? `<span class="chip">⚙${t.jobs.length}</span>` : "";
    const cache = t.cache?.length
      ? `<span class="chip">${t.cache.filter((c) => c.op === "hit").length}/${t.cache.length}c</span>`
      : "";

    bar.innerHTML =
      `<span class="logo">⬡ <b>Zerotal</b></span>${dot}<span class="bdiv">│</span>` +
      `<span class="meth ${t.method.toLowerCase()}">${esc(t.method)}</span>` +
      `<span class="bpath">${esc(t.path)}</span><span class="bdiv">│</span>` +
      `<span class="sc ${scCls(t.statusCode)}">${t.statusCode || "—"}</span>` +
      `<span class="dim">·</span><span class="${dCls(t.durationMs) || "dim"}">${fmt(t.durationMs)}</span>` +
      `<span class="dim">·</span><span class="dim">${t.queries.length}q</span>` +
      `${n1}${user}${mail}${jobs}${cache}<span class="sp"></span>` +
      `${catchUp}${liveBtn}${chrome}`;
  }

  /**
   * Requests | App.
   *
   * Two sections rather than fifteen tabs in one scrolling strip: they answer
   * different questions — what the app just did, and what the app is — and a
   * strip you have to scroll to reach the routes list is one you stop reaching
   * for.
   */
  function sectionSwitch(): string {
    const button = (id: "requests" | "app", label: string): string =>
      `<button class="sect${store.section === id ? " on" : ""}" ` +
      `data-section="${id}">${label}</button>`;
    return (
      `<div class="sects">${button("requests", "Requests")}${button("app", "App")}</div>` +
      `<span class="tabdiv"></span>`
    );
  }

  function renderTabs(): void {
    const c = ctx();
    tabStrip.innerHTML =
      sectionSwitch() +
      allTabs()
        .map((tab) => {
          const b = tab.badge?.(c);
          const badge = b?.count
            ? `<span class="tbdg${b.warn ? " warn" : ""}">${esc(String(b.count))}</span>`
            : "";
          const dot = tab.live && store.connected ? '<span class="ldot">●</span>' : "";
          return (
            `<button class="tab${store.activeTab === tab.id ? " active" : ""}" ` +
            `data-tab="${esc(tab.id)}">${esc(tab.label)}${badge}${dot}</button>`
          );
        })
        .join("");
  }

  function renderContent(force = false): void {
    const tab = currentTab();
    if (!tab) {
      content.innerHTML = '<p class="empty">Nothing to show</p>';
      return;
    }
    if (!store.selected && !tab.standsAlone) {
      contentKey = "waiting";
      content.innerHTML = '<p class="empty">Waiting for traffic…</p>';
      return;
    }
    const key =
      `${store.section}|${tab.id}|${store.selected?.id ?? ""}|` +
      `${tab.volatile ? store.revision : ""}`;
    if (!force && key === contentKey) return;
    const switchingTab = !contentKey.startsWith(`${store.section}|${tab.id}|`);
    contentKey = key;
    // A tab that keeps its own scaffold (the request list) detects it by looking
    // for it, so the host is only emptied when the tab itself changed.
    if (switchingTab) content.innerHTML = "";
    tab.render(content, ctx());
  }

  // ── Bar actions ─────────────────────────────────────────────────────────────

  bar.addEventListener("click", (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest("[data-action]") as HTMLElement | null;
    if (!btn) {
      togglePanel();
      return;
    }
    switch (btn.dataset["action"]) {
      case "toggle":
        togglePanel();
        break;
      case "live":
        store.follow();
        break;
      case "pin":
        store.pin();
        break;
      case "clear":
        transport.clear();
        break;
      case "theme":
        store.setTheme(THEME_CYCLE[store.theme]);
        break;
      case "dash":
        window.open(base, "_blank");
        break;
      case "close":
        transport.close();
        host.remove();
        break;
    }
  });

  tabStrip.addEventListener("click", (e: MouseEvent) => {
    const section = (e.target as HTMLElement).closest("[data-section]") as HTMLElement | null;
    if (section) {
      store.setSection(section.dataset["section"] === "app" ? "app" : "requests");
      return;
    }
    const btn = (e.target as HTMLElement).closest("[data-tab]") as HTMLElement | null;
    if (btn) store.setTab(btn.dataset["tab"]!);
  });

  // ── Content actions ─────────────────────────────────────────────────────────
  //
  // One delegated handler for every interactive thing a tab can render. Checked
  // most-specific first: the group toggle and the copy button both sit *inside* a
  // selectable row, so testing for the row first would make expanding a batch
  // also pin its first request.

  content.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;

    const copy = target.closest("[data-copy]") as HTMLElement | null;
    if (copy) {
      e.stopPropagation();
      void copyToClipboard(copy);
      return;
    }

    // The framework map is cached for the life of the panel, so re-reading it is
    // an explicit ask — for the case where a provider registered a route late.
    if (target.closest("[data-map-refresh]")) {
      e.stopPropagation();
      invalidateMap();
      renderContent(true);
      return;
    }

    const facet = target.closest("[data-facet]") as HTMLElement | null;
    if (facet) {
      e.stopPropagation();
      store.setFacets(
        toggleFacet(store.facets, facet.dataset["facet"]!, facet.dataset["value"] ?? ""),
      );
      return;
    }

    const group = target.closest("[data-group]") as HTMLElement | null;
    if (group) {
      e.stopPropagation();
      store.toggleGroup(group.dataset["group"]!);
      return;
    }

    const row = target.closest("[data-idx]") as HTMLElement | null;
    if (row) select(store.traces[Number(row.dataset["idx"])] ?? null);
  });

  content.addEventListener("input", (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.id !== "filter") return;
    // The input is never re-created, so there is no caret to restore: the store
    // update redraws the rows beneath it and leaves the field alone.
    store.setFilter(input.value);
  });

  content.addEventListener("scroll", () => {
    currentTab()?.onScroll?.(content, ctx());
  });

  /** Copy a button's payload, and say so where the user is looking. */
  async function copyToClipboard(btn: HTMLElement): Promise<void> {
    const text = btn.dataset["copy"] ?? "";
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.textContent;
      btn.textContent = "✓";
      btn.classList.add("done");
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove("done");
      }, COPY_FEEDBACK_MS);
    } catch {
      // Denied permission, or an insecure origin. Nothing useful to do about it,
      // and a thrown promise in a dev panel helps no one.
    }
  }

  // ── Resize ──────────────────────────────────────────────────────────────────
  //
  // A fixed 380px panel is either too small to read a stack trace in or too big
  // to see the page under. Pointer events rather than mouse, so a trackpad or a
  // pen drags it too, and capture so the drag survives leaving the strip.

  const grip = $("#grip");
  grip.addEventListener("pointerdown", (e: PointerEvent) => {
    if (standalone) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    grip.classList.add("dragging");

    const move = (ev: PointerEvent): void => {
      const next = window.innerHeight - ev.clientY;
      // Leave the host page a strip of itself: a panel dragged to full height is
      // one you cannot get out of by dragging.
      panel.style.height = `${Math.max(MIN_HEIGHT, Math.min(next, window.innerHeight - 60))}px`;
      reserveSpace();
    };
    const up = (): void => {
      grip.classList.remove("dragging");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      store.setHeight(panel.getBoundingClientRect().height);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });

  // ── Keyboard ────────────────────────────────────────────────────────────────

  /**
   * The panel's shortcuts fire only while the panel has focus.
   *
   * It is an overlay on somebody's application: binding `j` on `document` would
   * mean a developer typing into their own form navigated the trace list instead.
   * Focus is claimed when the panel is opened or clicked, and released the moment
   * anything on the page takes it back.
   */
  wrap.addEventListener("keydown", (e: KeyboardEvent) => {
    const typing =
      e.target instanceof HTMLElement &&
      (e.target.tagName === "INPUT" ||
        e.target.tagName === "TEXTAREA" ||
        e.target.isContentEditable);

    if (e.key === "Escape") {
      e.preventDefault();
      if (typing) (e.target as HTMLElement).blur();
      else if (!standalone && store.open) togglePanel();
      return;
    }
    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "/") {
      e.preventDefault();
      store.setTab("all");
      // After the store's render has put the field on screen.
      queueMicrotask(() => shadow.querySelector<HTMLInputElement>("#filter")?.focus());
    } else if (e.key >= "1" && e.key <= "9") {
      const tab = allTabs()[Number(e.key) - 1];
      if (tab) {
        e.preventDefault();
        store.setTab(tab.id);
      }
    }
  });

  wrap.addEventListener("pointerdown", () => {
    if (store.open) wrap.focus({ preventScroll: true });
  });

  /** Move the selection through the filtered list, which is what you can see. */
  function step(delta: number): void {
    const rows = store.visible();
    if (!rows.length) return;
    const at = rows.findIndex((r) => r.trace.id === store.selected?.id);
    const next = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta));
    select(rows[next]!.trace, false);
  }

  // Alt+D stays global — it is how you reach a panel that does not have focus.
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.altKey || e.metaKey) && e.key === "d") {
      e.preventDefault();
      togglePanel();
    }
  });

  // ── Commands ────────────────────────────────────────────────────────────────

  function togglePanel(): void {
    if (standalone) return; // nothing to collapse into
    store.setOpen(!store.open);
    panel.style.display = store.open ? "flex" : "none";
    reserveSpace();
    if (store.open) {
      wrap.focus({ preventScroll: true });
      renderContent(true);
    }
  }

  function select(trace: RequestTrace | null, switchTab = true): void {
    if (!trace) return;
    store.select(trace, { switchTab });
  }

  // ── Extension panels ────────────────────────────────────────────────────────
  // A late registration (flow enabling its timeline once its WebSocket is ready)
  // adds the tab live; `refresh` pushes a badge or content update.

  registry._emit = (panel) => {
    if (!store.open) return;
    renderTabs();
    // A panel that registers after we restored its tab from a previous session
    // would otherwise leave "Panel unavailable" on screen until the next click.
    if (store.activeTab === `plugin:${panel.id}`) renderContent(true);
  };
  registry._refresh = (id) => {
    if (!store.open) return;
    renderTabs();
    if (store.activeTab.startsWith("plugin:") && (!id || store.activeTab === `plugin:${id}`)) {
      renderContent(true);
    }
  };

  // ── Go ──────────────────────────────────────────────────────────────────────

  store.subscribe(render);
  render();
}
