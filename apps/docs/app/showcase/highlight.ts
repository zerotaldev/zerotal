/**
 * A tiny JSX/TS syntax highlighter → HTML with Tailwind colour spans, for the `Demo` code
 * block. The showcase pages run the Flow runtime (not the docs' Prism), so we colour the
 * snippet server-side at render time. Tokens are escaped per-token, so the output is safe to
 * drop in via `dangerouslySetInnerHTML`, and an element's `textContent` still yields the raw
 * code (so the copy button works).
 */
const TOKEN =
  /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|('(?:[^'\\]|\\.)*')|(<\/?[A-Za-z][\w.]*|\/?>)|\b(this|true|false|null|undefined|new|const|return|async|await)\b|([A-Za-z_]\w*)(?=\s*=)|(\d+)|([\s\S])/g;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const span = (cls: string, text: string): string => `<span class="${cls}">${esc(text)}</span>`;

export function highlight(code: string): string {
  let out = "";
  let plain = "";
  const flush = (): void => {
    if (plain) {
      out += esc(plain);
      plain = "";
    }
  };

  for (const m of code.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      flush();
      out += span("text-slate-500 italic", m[1]); // comment
    } else if (m[2] !== undefined || m[3] !== undefined) {
      flush();
      out += span("text-emerald-400", (m[2] ?? m[3])!); // string
    } else if (m[4] !== undefined) {
      flush();
      out += span("text-sky-400", m[4]); // tag bracket + name
    } else if (m[5] !== undefined) {
      flush();
      out += span("text-orange-400", m[5]); // keyword (this, true, …)
    } else if (m[6] !== undefined) {
      flush();
      out += span("text-violet-400", m[6]); // attribute / prop name
    } else if (m[7] !== undefined) {
      flush();
      out += span("text-amber-400", m[7]); // number
    } else {
      plain += m[8]; // any other char — accumulate, escaped on flush
    }
  }
  flush();
  return out;
}
