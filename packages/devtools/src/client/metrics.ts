/**
 * What the *browser* measured, alongside what the server did.
 *
 * The panel reports server duration as though it were the user's experience. It
 * is not: a 12ms response that the browser spends 900ms parsing, laying out, and
 * painting is a slow page, and nothing in the trace said so. The panel already
 * runs JavaScript on the page and had never asked the one API that knows.
 *
 * Read once, after the load event, from the Performance timeline — no polling,
 * no observer left running, nothing sampled per frame. It is a report on the
 * document, so there is exactly one of it per page load.
 */

/** One browser-side measurement, in the shape the panel's stat grid draws. */
export interface ClientMetric {
  label: string;
  /** Milliseconds. Rounded — sub-millisecond precision here is noise. */
  value: number;
  /** Longer text for the row's tooltip. */
  detail: string;
}

/**
 * The phases of a page load, as the Navigation Timing entry names them.
 *
 * Chosen for what a developer can act on: time to the first byte is the server
 * plus the network, DOM interactive is parsing, and load is everything the page
 * asked for. The rest of the entry is either derived from these or is about DNS
 * and TLS, which is not what a request inspector is for.
 */
function navigationMetrics(nav: PerformanceNavigationTiming): ClientMetric[] {
  const out: ClientMetric[] = [];
  const add = (label: string, value: number, detail: string): void => {
    if (Number.isFinite(value) && value > 0) out.push({ label, value: Math.round(value), detail });
  };
  add("TTFB", nav.responseStart - nav.requestStart, "Request sent → first byte back");
  add("Response", nav.responseEnd - nav.responseStart, "First byte → last byte");
  add("DOM interactive", nav.domInteractive - nav.responseEnd, "Parsing the document");
  add("DOM complete", nav.domComplete - nav.domInteractive, "Subresources and deferred scripts");
  add("Load", nav.loadEventEnd - nav.startTime, "Navigation start → load event");
  return out;
}

/**
 * Paint timings, when the browser recorded them.
 *
 * First Contentful Paint is the one number that most closely tracks "did that
 * feel fast", and it is the only Web Vital available without a library and
 * without leaving an observer running for the life of the page.
 */
function paintMetrics(): ClientMetric[] {
  try {
    return performance
      .getEntriesByType("paint")
      .filter((e) => e.name === "first-contentful-paint")
      .map((e) => ({
        label: "First paint",
        value: Math.round(e.startTime),
        detail: "Navigation start → first content on screen",
      }));
  } catch {
    return [];
  }
}

/**
 * Everything the browser can tell us about this page load, or an empty list.
 *
 * Empty rather than throwing on every browser that does not implement the API,
 * and empty before the load event, when the numbers are not final.
 */
export function collectClientMetrics(): ClientMetric[] {
  try {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    // `loadEventEnd` is 0 until the load event has actually fired; reading before
    // then produces negative durations rather than an error.
    if (!nav || nav.loadEventEnd <= 0) return paintMetrics();
    return [...navigationMetrics(nav), ...paintMetrics()];
  } catch {
    return [];
  }
}

/**
 * Run `fn` once the page has finished loading.
 *
 * A panel injected into a page that has already loaded — which is what happens
 * on a hot reload — would otherwise wait for an event that has been and gone.
 */
export function onceLoaded(fn: () => void): void {
  if (document.readyState === "complete") {
    // Not synchronously: `loadEventEnd` is stamped *after* the handlers run, so
    // reading it in the same turn as a just-fired load event reads a zero.
    setTimeout(fn, 0);
    return;
  }
  window.addEventListener("load", () => setTimeout(fn, 0), { once: true });
}
