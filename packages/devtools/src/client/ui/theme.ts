/**
 * Every style the panel has, as one string injected into its shadow root.
 *
 * Two palettes, one set of rules. The tokens are declared twice — once on `#wrap`
 * and once on `#wrap.light` — and a class decides which applies, rather than a
 * media query deciding it in CSS. That keeps the "follow the system" case and the
 * explicit override from fighting each other over specificity: the panel resolves
 * the three-way choice (auto / light / dark) in one place in JavaScript and the
 * stylesheet only ever sees the answer.
 */

/** The one place a colour is named. Every rule below reads these through `var()`. */
const TOKENS = `
#wrap {
  --bg: #1a1b26; --surf: #24283b; --card: #2f3452; --bdr: #3b4261;
  /* --muted carries labels, hints and every inactive tab. At the palette's own
     #565f89 that is 2.35:1 on --surf — below AA for text of any size, and this
     is 10–11px text. Lifted until it clears 4.5:1 while staying recessive. */
  --text: #c0caf5; --muted: #8790bd; --purple: #7aa2f7;
  --green: #9ece6a; --yellow: #e0af68; --red: #f7768e;
  --cyan: #7dcfff; --orange: #ff9e64;
  --childbg: rgba(0,0,0,.15);
}
#wrap.light {
  --bg: #f4f4f8; --surf: #e8e9f0; --card: #dcdee8; --bdr: #c0c4d4;
  --text: #343b58; --muted: #565c7d; --purple: #34548a;
  --green: #33635c; --yellow: #8f5e15; --red: #c64343;
  --cyan: #0f4b6e; --orange: #965027;
  --childbg: rgba(0,0,0,.05);
}`;

export const CSS = `<style>
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
${TOKENS}
#wrap {
  font: 12px/1.5 'JetBrains Mono','Fira Code','SF Mono',ui-monospace,monospace;
  color: var(--text);
}
#wrap:focus { outline: none; }
/* The container itself takes focus on open and should not draw a ring for it.
   Anything a person actually tabs to must — the panel used to suppress focus
   everywhere, which left keyboard navigation invisible. */
#wrap :focus-visible {
  outline: 2px solid var(--purple);
  outline-offset: -2px;
  border-radius: 2px;
}
/* Numbers line up only if the digits are the same width. Durations sit in a
   right-aligned column, and proportional digits are what made its left edge
   ragged from row to row. */
.num, .dur, .meth, .stat .sval, .tlbl { font-variant-numeric: tabular-nums; }
/* ── utility colours ──────────────────────────────────────────────────────── */
.green  { color: var(--green);  }
.yellow { color: var(--yellow); }
.red    { color: var(--red);    }
.cyan   { color: var(--cyan);   }
.dim    { color: var(--muted);  }
/* ── bar ──────────────────────────────────────────────────────────────────── */
#bar {
  height: 32px; background: var(--bg); border-top: 1px solid var(--bdr);
  display: flex; align-items: center; gap: 5px; padding: 0 8px;
  cursor: pointer; user-select: none; overflow: hidden; flex-shrink: 0;
}
.logo { color: var(--purple); font-weight: 700; font-size: 13px; flex-shrink: 0; }
.dot  { font-size: 8px; }
.dot.ok  { color: var(--green); }
.dot.err { color: var(--red); animation: blink 1s step-start infinite; }
@keyframes blink { 50% { opacity: 0.25; } }
.bdiv { color: var(--bdr); flex-shrink: 0; }
.sp   { flex: 1; }
.meth { font-weight: 700; font-size: 11px; flex-shrink: 0; }
.meth.get    { color: var(--green);  }
.meth.post   { color: var(--cyan);   }
.meth.put, .meth.patch { color: var(--yellow); }
.meth.delete { color: var(--red);    }
/* Not an HTTP method: a Flow action, which arrives over the socket against a
   synthetic GET of its own page. Its own colour so the list does not read as two
   loads of that page. */
.meth.flow   { color: var(--purple); }
.bpath { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.sc   { font-weight: 700; font-size: 11px; flex-shrink: 0; }
.sc.ok    { color: var(--green);  }
.sc.redir { color: var(--cyan);   }
.sc.cli   { color: var(--yellow); }
.sc.srv   { color: var(--red);    }
.chip {
  font-size: 10px; padding: 1px 5px; border-radius: 999px;
  background: var(--card); border: 1px solid var(--bdr); white-space: nowrap; flex-shrink: 0;
}
.chip.warn { border-color: var(--yellow); color: var(--yellow); }
.chip.ok   { border-color: var(--green);  color: var(--green);  }
.ibtn {
  height: 22px; padding: 0 6px;
  background: var(--card); border: 1px solid var(--bdr); color: var(--text);
  cursor: pointer; border-radius: 4px; font-size: 11px; font-family: inherit;
  display: flex; align-items: center; gap: 3px; flex-shrink: 0;
}
.ibtn:hover     { background: var(--surf); border-color: var(--purple); }
.ibtn.live-on   { border-color: var(--green); color: var(--green); }
/* New traces arrived while pinned — an offer, never a jump. */
.ibtn.pending   { border-color: var(--purple); color: var(--purple); animation: pulse 2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.55; } }
/* ── panel ────────────────────────────────────────────────────────────────── */
#panel {
  height: 380px; background: var(--bg); border-top: 1px solid var(--bdr);
  display: flex; flex-direction: column; position: relative;
}
/* Drag strip. Sits above the tab row and overhangs upward so it is grabbable
   without stealing clicks from the host page's last few pixels. */
#grip {
  position: absolute; top: -3px; left: 0; right: 0; height: 7px;
  cursor: ns-resize; z-index: 2;
}
#grip:hover, #grip.dragging { background: var(--purple); opacity: .5; }
#tabs {
  display: flex; gap: 2px; padding: 4px 8px 0;
  background: var(--surf); border-bottom: 1px solid var(--bdr);
  flex-shrink: 0; overflow-x: auto;
}
.tab {
  height: 28px; padding: 0 10px; background: transparent; border: none;
  border-bottom: 2px solid transparent; color: var(--muted); cursor: pointer;
  font: inherit; font-size: 11px; white-space: nowrap;
  display: flex; align-items: center; gap: 4px;
}
.tab:hover  { color: var(--text); }
.tab.active { color: var(--text); border-bottom-color: var(--purple); }
.tbdg {
  font-size: 10px; padding: 0 4px; border-radius: 999px;
  background: var(--card); min-width: 16px; text-align: center;
}
.tbdg.warn { background: transparent; color: var(--yellow); }
.ldot { font-size: 8px; color: var(--green); animation: blink 1.5s step-start infinite; }
#content { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; }
/* ── content shared ───────────────────────────────────────────────────────── */
.empty { color: var(--muted); text-align: center; padding: 40px 20px; }
.sec   { padding: 10px 12px; border-bottom: 1px solid var(--bdr); }
.sec:last-child { border-bottom: none; }
.stitle {
  font-size: 10px; text-transform: uppercase; letter-spacing: .6px;
  color: var(--muted); margin-bottom: 8px;
  display: flex; align-items: center; gap: 6px;
}
.stats  { display: flex; flex-wrap: wrap; gap: 1px; background: var(--bdr); border-bottom: 1px solid var(--bdr); }
.stat   { flex: 1; min-width: 90px; padding: 8px 12px; background: var(--bg); }
.slbl   { font-size: 10px; color: var(--muted); margin-bottom: 2px; }
.sval   { font-weight: 700; font-size: 13px; }
.rcard  { padding: 8px 12px; border-bottom: 1px solid var(--bdr); background: var(--surf); font-size: 12px; }
/* ── copy buttons ─────────────────────────────────────────────────────────── */
.cpy {
  background: transparent; border: 1px solid transparent; color: var(--muted);
  font: inherit; font-size: 10px; line-height: 1; padding: 1px 4px;
  border-radius: 3px; cursor: pointer; flex-shrink: 0; opacity: 0;
  transition: opacity .1s;
}
.cpy:hover { color: var(--purple); border-color: var(--bdr); }
.cpy.done  { color: var(--green); opacity: 1; }
.qrow:hover .cpy, .lrow:hover .cpy, .sec:hover .cpy, .tleaf:hover .cpy,
.tbranch > summary:hover .cpy, .crow:hover .cpy, .cpy:focus { opacity: 1; }
/* ── queries ──────────────────────────────────────────────────────────────── */
.qrow  { padding: 8px 12px; border-bottom: 1px solid var(--bdr); }
.qrow:last-child { border-bottom: none; }
.qmeta { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.qdur  { font-weight: 700; font-size: 11px; min-width: 44px; }
.qbar  { flex: 1; height: 4px; background: var(--card); border-radius: 2px; max-width: 120px; }
.qfill { height: 100%; background: var(--purple); border-radius: 2px; }
.qsql  { font-size: 11px; white-space: pre-wrap; word-break: break-all; }
.qbind { font-size: 10px; color: var(--muted); margin-top: 3px; }
.bind  { color: var(--orange); }
.wrow  { padding: 8px 12px; border-bottom: 1px solid var(--bdr); border-left: 3px solid var(--yellow); }
.whead { color: var(--yellow); margin-bottom: 4px; font-size: 12px; }
.wfix  { font-size: 10px; color: var(--muted); margin-top: 5px; }
.wfix code {
  font: inherit; color: var(--cyan); background: var(--card);
  padding: 1px 4px; border-radius: 3px;
}
/* ── exception banner ─────────────────────────────────────────────────────── */
.exc {
  padding: 9px 12px; background: var(--card); border-left: 3px solid var(--red);
  border-bottom: 1px solid var(--bdr);
}
.exhead { color: var(--red); font-weight: 700; font-size: 11px; margin-bottom: 3px; display: flex; align-items: center; gap: 6px; }
.exmsg  { font-size: 11px; white-space: pre-wrap; word-break: break-word; }
/* ── logs ─────────────────────────────────────────────────────────────────── */
.lrow  { display: flex; gap: 6px; padding: 4px 12px; border-bottom: 1px solid var(--bdr); }
.ltime { color: var(--muted); min-width: 54px; font-size: 10px; }
.llvl  { min-width: 38px; font-weight: 700; font-size: 11px; }
.llvl.log, .llvl.debug, .llvl.info { color: var(--cyan);   }
.llvl.warn  { color: var(--yellow); }
.llvl.error { color: var(--red);    }
.lmsg  { font-size: 11px; white-space: pre-wrap; word-break: break-all; flex: 1; }
/* ── request kv table ─────────────────────────────────────────────────────── */
.kv    { width: 100%; border-collapse: collapse; font-size: 11px; }
.kv td { padding: 4px 12px; border-bottom: 1px solid var(--bdr); vertical-align: top; }
.kv td:first-child { color: var(--muted); min-width: 160px; font-size: 10px; }
/* ── cards (mail / jobs) ──────────────────────────────────────────────────── */
.card  { padding: 9px 12px; border-bottom: 1px solid var(--bdr); }
/* ── mail preview ─────────────────────────────────────────────────────────── */
.mprev { margin-top: 7px; }
.mprev > summary {
  cursor: pointer; font-size: 10px; color: var(--muted);
  list-style: none; user-select: none; width: fit-content;
}
.mprev > summary::-webkit-details-marker { display: none; }
.mprev > summary::before { content: '▸ '; }
.mprev[open] > summary::before { content: '▾ '; }
.mprev > summary:hover { color: var(--purple); }
.mframe {
  width: 100%; height: 320px; margin-top: 6px; border: 1px solid var(--bdr);
  border-radius: 4px; background: #fff;
}
/* ── all-requests list ────────────────────────────────────────────────────── */
/* Fixed height: the virtualiser positions rows arithmetically above ~200 of
   them, and a row that can grow would put every offset out. */
.hrow {
  display: flex; align-items: center; gap: 6px;
  padding: 0 12px; height: 26px; border-bottom: 1px solid var(--bdr);
  cursor: pointer; font-size: 11px; overflow: hidden;
}
.hrow:hover { background: var(--surf); }
.hrow.cur   { background: var(--card); }
.hrow.on    { box-shadow: inset 2px 0 0 var(--purple); }
.hrow.err   { border-left: 3px solid var(--red); padding-left: 9px; }
.hrow.child { padding-left: 26px; background: var(--childbg); }
.hpath { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hexc  { color: var(--red); font-size: 10px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gtog {
  font-size: 10px; padding: 0 5px; border-radius: 999px; cursor: pointer;
  background: var(--card); border: 1px solid var(--purple); color: var(--purple);
  font-family: inherit; flex-shrink: 0;
}
.gtog:hover { background: var(--surf); }
/* Windowed rendering: two spacers stand in for the rows that are not drawn. */
.vpad { flex-shrink: 0; }
/* ── filter bar ───────────────────────────────────────────────────────────── */
.fbar {
  display: flex; gap: 6px; align-items: center; padding: 6px 12px;
  border-bottom: 1px solid var(--bdr); background: var(--surf);
  position: sticky; top: 0; z-index: 1;
}
.finput {
  flex: 1; min-width: 90px; height: 24px; padding: 0 8px; font: inherit; font-size: 11px;
  background: var(--bg); border: 1px solid var(--bdr); border-radius: 4px; color: var(--text);
}
.finput:focus { outline: none; border-color: var(--purple); }
.finput::placeholder { color: var(--muted); }
.facets {
  display: flex; gap: 4px; align-items: center; flex-wrap: wrap;
  padding: 5px 12px; border-bottom: 1px solid var(--bdr); background: var(--surf);
}
.fchip {
  font: inherit; font-size: 10px; padding: 1px 6px; border-radius: 999px; cursor: pointer;
  background: transparent; border: 1px solid var(--bdr); color: var(--muted);
}
.fchip:hover { color: var(--text); border-color: var(--muted); }
.fchip.on    { background: var(--card); color: var(--purple); border-color: var(--purple); }
.fchip.on.warn { color: var(--yellow); border-color: var(--yellow); }
.fsep { width: 1px; height: 12px; background: var(--bdr); margin: 0 3px; }
/* ── timeline waterfall ───────────────────────────────────────────────────── */
.trow  { display: flex; align-items: center; gap: 8px; padding: 3px 12px; font-size: 11px; }
.trow:hover { background: var(--surf); }
.tlbl  { min-width: 78px; font-size: 10px; text-align: right; flex-shrink: 0; }
.ttrack { flex: 1; height: 12px; position: relative; background: var(--card); border-radius: 2px; }
.tmark {
  position: absolute; top: 0; height: 12px; min-width: 3px; border-radius: 2px;
  background: var(--purple);
}
.tmark.query { background: var(--purple); }
.tmark.cache { background: var(--cyan);   }
.tmark.mail  { background: var(--green);  }
.tmark.job   { background: var(--orange); }
.tmark.log   { background: var(--muted);  }
.tmark.warn  { background: var(--red);    }
.tmark.chan  { background: var(--yellow); }
.ttxt  { flex: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.tkey  { display: flex; gap: 10px; flex-wrap: wrap; padding: 6px 12px; font-size: 10px; color: var(--muted); }
/* position:static undoes .tmark, which the legend swatch reuses for its colour.
   .tmark is absolutely positioned for the waterfall, and in the legend — whose
   rows are not positioned — that sent every swatch to the nearest positioned
   ancestor, leaving seven squares stacked above their own labels. */
.tkey i { position: static; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 3px; vertical-align: middle; font-style: normal; }
/* ── an open request ──────────────────────────────────────────────────────── */
.lvhead {
  display: flex; align-items: baseline; gap: 8px; padding: 7px 12px;
  border-bottom: 1px solid var(--bdr); background: var(--surf);
  position: sticky; top: 0; z-index: 1;
}
.hchev { width: 12px; flex-shrink: 0; color: var(--muted); text-align: center; }
.hdetail {
  background: var(--childbg); border-bottom: 1px solid var(--bdr);
  border-left: 2px solid var(--purple);
}
/* The request's own tab strip — alternatives, not a stack you scroll past. */
.dsecs {
  display: flex; gap: 2px; align-items: center; flex-wrap: wrap;
  padding: 4px 10px; border-bottom: 1px solid var(--bdr); background: var(--surf);
}
.dsect {
  display: inline-flex; align-items: center; gap: 4px;
  background: none; border: 0; border-radius: 3px; cursor: pointer;
  padding: 3px 7px; font: inherit; font-size: 11px; color: var(--muted);
}
.dsect:hover { color: var(--text); background: var(--card); }
.dsect.on { color: var(--text); background: var(--card); font-weight: 700; }
.tbtn {
  background: none; border: 1px solid var(--bdr); border-radius: 3px;
  color: var(--muted); cursor: pointer; padding: 2px 8px; font: inherit; font-size: 11px;
  flex-shrink: 0;
}
.tbtn:hover { color: var(--text); border-color: var(--muted); }
.dsec-n {
  background: var(--card); color: var(--text); border-radius: 6px;
  padding: 0 5px; font-size: 10px; font-variant-numeric: tabular-nums;
}
.dsec-n.warn { background: var(--red); color: var(--bg); }
/* ── generic channel rows ─────────────────────────────────────────────────── */
.crow  { padding: 7px 12px; border-bottom: 1px solid var(--bdr); }
.crow.warn { border-left: 3px solid var(--yellow); }
.chead { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.cttl  { font-size: 11px; word-break: break-word; }
.cmeta { font-size: 10px; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; }
/* Badge accents. Assigned by hashing the badge's own text, so repeated values
   stay the same colour and devtools needs no vocabulary to tell them apart. */
.chip.a0 { border-color: var(--purple); color: var(--purple); }
.chip.a1 { border-color: var(--cyan);   color: var(--cyan);   }
.chip.a2 { border-color: var(--green);  color: var(--green);  }
.chip.a3 { border-color: var(--orange); color: var(--orange); }
.chip.a4 { border-color: var(--yellow); color: var(--yellow); }
.chip.a5 { border-color: var(--red);    color: var(--red);    }
.chip.flag { font-size: 9px; padding: 0 4px; text-transform: uppercase; letter-spacing: .4px; }
/* ── channel: tree ────────────────────────────────────────────────────────── */
.tnode { border-bottom: 1px solid var(--bdr); }
.tbranch > summary {
  padding: 5px 12px; cursor: pointer; list-style: none; user-select: none;
  display: flex; align-items: center; gap: 6px; font-size: 11px;
}
.tbranch > summary::-webkit-details-marker { display: none; }
.tbranch > summary::before { content: '▸'; color: var(--muted); font-size: 9px; }
.tbranch[open] > summary::before { content: '▾'; }
.tbranch > summary:hover { background: var(--surf); }
.tleaf { padding: 5px 12px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px; }
.tleaf:hover { background: var(--surf); }
.tname { font-weight: 600; }
.tattr { font-size: 10px; color: var(--muted); }
.tkids { border-left: 1px solid var(--bdr); margin-left: 17px; }
/* ── channel: table ───────────────────────────────────────────────────────── */
.ctbl { width: 100%; border-collapse: collapse; font-size: 11px; }
.ctbl th {
  text-align: left; padding: 5px 12px; font-size: 10px; font-weight: 400;
  text-transform: uppercase; letter-spacing: .5px; color: var(--muted);
  background: var(--surf); border-bottom: 1px solid var(--bdr);
  position: sticky; top: 0;
}
.ctbl td { padding: 5px 12px; border-bottom: 1px solid var(--bdr); vertical-align: top; }
.ctbl tr.warn td:first-child { box-shadow: inset 3px 0 0 var(--yellow); }
/* ── channel: grouped ─────────────────────────────────────────────────────── */
.cgrp > summary {
  padding: 6px 12px; cursor: pointer; list-style: none; user-select: none;
  background: var(--surf); border-bottom: 1px solid var(--bdr);
  display: flex; align-items: center; gap: 8px; font-size: 11px;
}
.cgrp > summary::-webkit-details-marker { display: none; }
.cgrp > summary::before { content: '▸'; color: var(--muted); font-size: 9px; }
.cgrp[open] > summary::before { content: '▾'; }
/* ── section switcher ─────────────────────────────────────────────────────── */
.sects { display: flex; gap: 1px; align-self: center; flex-shrink: 0; margin-bottom: 4px; }
.sect {
  font: inherit; font-size: 10px; padding: 3px 9px; cursor: pointer;
  background: var(--bg); border: 1px solid var(--bdr); color: var(--muted);
  text-transform: uppercase; letter-spacing: .5px;
}
.sect:first-child { border-radius: 4px 0 0 4px; }
.sect:last-child  { border-radius: 0 4px 4px 0; }
.sect:hover { color: var(--text); }
.sect.on { background: var(--card); color: var(--purple); border-color: var(--purple); }
.tabdiv { width: 1px; background: var(--bdr); align-self: stretch; margin: 4px 6px 0; flex-shrink: 0; }
a.link { color: var(--cyan); text-decoration: none; }
a.link:hover { text-decoration: underline; }
/* ── source locations ─────────────────────────────────────────────────────── */
.src {
  font-size: 10px; color: var(--muted); flex-shrink: 0; white-space: nowrap;
  max-width: 220px; overflow: hidden; text-overflow: ellipsis;
}
a.src.link { color: var(--cyan); text-decoration: none; }
a.src.link:hover { text-decoration: underline; }
/* ── exception frames ─────────────────────────────────────────────────────── */
.frame {
  display: flex; align-items: baseline; gap: 8px; justify-content: space-between;
  padding: 4px 12px; border-bottom: 1px solid var(--bdr); font-size: 11px;
}
.frame:hover { background: var(--surf); }
/* Framework frames are context, not the answer — dimmed so your own code stands
   out of a forty-frame trace without being hidden from it. */
.frame.vendor { opacity: .5; }
.frame .src { max-width: 60%; }
.fnname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* ── chip rows (session keys) ─────────────────────────────────────────────── */
.chips { display: flex; gap: 4px; flex-wrap: wrap; }
/* ── keyboard help ────────────────────────────────────────────────────────── */
.keys { padding: 6px 12px; font-size: 10px; color: var(--muted); display: flex; gap: 12px; flex-wrap: wrap; border-top: 1px solid var(--bdr); }
.keys kbd {
  font: inherit; background: var(--card); border: 1px solid var(--bdr);
  border-radius: 3px; padding: 0 3px; color: var(--text);
}
/* ── standalone dashboard ─────────────────────────────────────────────────── */
#wrap.standalone { display: flex; flex-direction: column; height: 100vh; background: var(--bg); }
#wrap.standalone #panel { flex: 1; height: auto !important; border-top: none; }
#wrap.standalone #grip { display: none; }
#wrap.standalone #bar { border-top: none; border-bottom: 1px solid var(--bdr); cursor: default; order: -1; }
</style>`;

/** What the user asked for, which is not the same as which palette is showing. */
export type ThemeChoice = "auto" | "dark" | "light";

/**
 * Resolve the three-way choice to the one class the stylesheet understands.
 *
 * `auto` asks the browser, and the panel re-asks whenever the system flips, so a
 * machine that switches at sunset does not leave a dark panel on a light page.
 */
export function isLightTheme(choice: ThemeChoice): boolean {
  if (choice === "light") return true;
  if (choice === "dark") return false;
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    // No matchMedia (a very old browser, a test harness) — dark is the default
    // the panel has always had.
    return false;
  }
}

/** The next choice in the toggle's cycle, and the icon that stands for it. */
export const THEME_CYCLE: Record<ThemeChoice, ThemeChoice> = {
  auto: "dark",
  dark: "light",
  light: "auto",
};

export const THEME_ICON: Record<ThemeChoice, string> = {
  auto: "◐",
  dark: "●",
  light: "○",
};
