/**
 * Attaching a file, in a real browser.
 *
 * This exists because the in-process test was not enough and I said it was.
 * `FlowTest` can hand the component a signed reference directly — and that
 * passed — but it never opens a socket, never runs the client bridge and never
 * touches an `<input type="file">`. It proved the *server* half and said nothing
 * about the half in question: the browser noticing the change event, POSTing the
 * bytes, and `$set`ting the reference back.
 *
 * Three traps this walked into, all worth keeping in mind:
 *
 *   - `waitUntil(expression, label, timeout)` takes a **string** evaluated in the
 *     page. Passing a function makes `Boolean(function…)` truthy immediately, so
 *     every wait returns at once and every assertion after it is meaningless.
 *   - Controls are located by the action they carry, never by their label: this
 *     app renders in isiZulu, and an earlier probe reported a missing button
 *     only because it searched for the English word "Attach".
 *   - "Is it still uploading" is read off the live Alpine state, not the markup —
 *     the `x-text` expression contains the word "Uploading" whatever the state
 *     is, so a regex over HTML always says yes.
 *
 * Runs against a dev server it starts itself, on the dev database, and leaves
 * one attachment behind on whichever issue it picked. Skipped where no browser
 * is installed.
 */
import { test, beforeAll, afterAll, expect } from "bun:test";
import { FlowBrowser } from "@zerotal/flow/browser";

const maybe = FlowBrowser.available() ? test : test.skip;
const BASE = "http://localhost:3009";
let proc: ReturnType<typeof Bun.spawn> | null = null;

beforeAll(async () => {
  // Reuse a server already listening — lets the log be inspected out of band.
  try {
    if ((await fetch(BASE + "/login")).ok) return;
  } catch {
    /* start our own below */
  }
  proc = Bun.spawn(["bun", "zt.ts", "serve", "--port=3009"], {
    cwd: import.meta.dir + "/..",
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + "/login")).ok) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(500);
  }
  throw new Error("server did not start");
}, 60_000);

afterAll(() => proc?.kill());

/** The confirm control, by its action — the page is not in English. */
const ATTACH_BTN =
  "Array.from(document.querySelectorAll('button')).find(function(b){return b.getAttribute('flow:click')==='attachFile'})";

maybe(
  "picking a file uploads it, binds the reference, and saves",
  async () => {
    const page = await FlowBrowser.open(BASE + "/login");
    try {
      await page.fill("#email", "ada@example.com");
      await page.fill("#password", "password");
      await page.click('button[type="submit"]');
      await page.waitUntil(
        "location.pathname === '/projects'",
        "sign-in to land on /projects",
        15000,
      );

      await page.goto(BASE + "/projects/apollo");
      await page.waitUntil(
        "Array.from(document.querySelectorAll('a[href]')).some(function(a){" + "var h=a.getAttribute('href')||'';var i=h.lastIndexOf('/issues/');" + "return i!==-1 && /^[0-9]+$/.test(h.slice(i+8))})",
        "the issue list to render a row",
        15000,
      );
      const href = await page.evaluate<string>(
        "(function(){var out='';" + "Array.from(document.querySelectorAll('a[href]')).forEach(function(x){" + "var h=x.getAttribute('href')||'';var i=h.lastIndexOf('/issues/');" + "if(!out && i!==-1 && /^[0-9]+$/.test(h.slice(i+8))) out=h;});return out})()",
      );
      expect(href).not.toBe("");

      await page.goto(BASE + href);
      await page.waitUntil("!!document.querySelector('input[type=file]')", "the dropzone", 15000);

      // Record the upload lifecycle events and every socket frame the client
      // sends, so a failure says which step stopped.
      await page.evaluate(
        "(function(){window.__probe={events:[],frames:[],recv:[]};" +
          "['flow:upload-start','flow:upload-progress','flow:upload-finish','flow:upload-error']" +
          ".forEach(function(n){window.addEventListener(n,function(e){window.__probe.events.push(n+':'+JSON.stringify(e.detail))})});" +
          "})()",
      );

      // A name no earlier run can have left behind: the dev database persists,
      // and a stale attachment once made a probe read as a pass.
      const NAME = "probe-" + Date.now() + ".txt";

      // Retried, because Flow patches the page after mount and the morph can
      // replace the dropzone between finding the input and writing to it. The
      // dataset flag keeps the retry from sending the file twice.
      await page.waitUntil(
        "(function(){var i=document.querySelector('input[type=file]');if(!i)return false;" +
          "if(i.dataset.probeSent)return true;var d=new DataTransfer();" +
          "d.items.add(new File(['hello'],'" +
          NAME +
          "',{type:'text/plain'}));" +
          "i.files=d.files;i.dataset.probeSent='1';" +
          "i.dispatchEvent(new Event('change',{bubbles:true}));return true})()",
        "the file to be handed to the input",
        15000,
      );

      // The reference binding is the whole point: the confirm control only exists
      // while the component holds the file, so waiting for it waits for the
      // server-side bind and the patch that follows it.
      await page.waitUntil(
        "!!(" + ATTACH_BTN + ")",
        "the upload reference to bind to the component",
        15000,
      );

      const uploading = await page.evaluate<boolean>(
        "(function(){var z=document.querySelector('.flow-fileupload');" +
          "return !!(z && z.__x && z.__x.$data && z.__x.$data.uploading)})()",
      );
      expect(uploading).toBe(false);

      await page.waitUntil(
        "(function(){var b=" + ATTACH_BTN + ";if(!b)return false;b.click();return true})()",
        "the confirm control to be clickable",
        15000,
      );

      await page.waitUntil(
        "document.body.textContent.indexOf(" +
          JSON.stringify(NAME) +
          ") !== -1 && document.querySelectorAll('a[href*=\"/attachments/\"]').length > 0",
        "the attachment to be saved and listed",
        20000,
      );

      expect(page.consoleErrors()).toEqual([]);
      // A file input rejects any programmatic `value` write, and that throw used to
      // escape the frame handler — killing the morph and wedging the component's
      // action queue. An empty page-error list is what proves it no longer does.
      expect(page.pageErrors()).toEqual([]);
    } finally {
      await page.close();
    }
  },
  120_000,
);
