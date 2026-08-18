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
import { BASE, startServer, stopServer, signIn, createIssue } from "./support/browser.ts";

const maybe = FlowBrowser.available() ? test : test.skip;

beforeAll(() => startServer(import.meta.dir + "/.."), 60_000);
afterAll(() => stopServer());

/**
 * Hand `name` to the page's file input and fire the change the bridge listens for.
 *
 * Keeps going until an upload has actually started, because the patch that
 * follows a Flow navigation morphs the dropzone and replaces the input — measured,
 * not guessed: the element the file was handed to is gone by the time the upload
 * finishes. Picking once and trusting it is a race the fixture loses occasionally
 * and reports as "the reference never bound", which reads like a product bug.
 *
 * The dataset flag is per element, so a replaced input is picked again and an
 * untouched one is left alone — no double upload.
 */
async function pickFile(page: FlowBrowser, name: string): Promise<void> {
  await page.evaluate(
    "(function(){if(window.__started)return;window.__started=false;" +
      "window.addEventListener('flow:upload-start',function(){window.__started=true})})()",
  );
  await page.waitUntil(
    "(function(){if(window.__started)return true;" +
      "var i=document.querySelector('input[type=file]');if(!i)return false;" +
      "if(i.dataset.probeSent)return false;var d=new DataTransfer();" +
      "d.items.add(new File(['hello'],'" +
      name +
      "',{type:'text/plain'}));" +
      "i.files=d.files;i.dataset.probeSent='1';" +
      "i.dispatchEvent(new Event('change',{bubbles:true}));return false})()",
    "an upload to start from the file input",
    15000,
  );
}

/** The confirm control, by its action — the page is not in English. */
const ATTACH_BTN =
  "Array.from(document.querySelectorAll('button')).find(function(b){return b.getAttribute('flow:click')==='attachFile'})";


/**
 * Is `name` in the attachment *list*, as opposed to merely on the page?
 *
 * The dropzone prints the chosen filename the moment it is picked, so a plain
 * text search says yes before anything has been attached at all — which made an
 * earlier version of this test click nothing, assert nothing, and then blame the
 * broadcast for a file that was never saved. A row with a download link is the
 * thing that only exists once the server has it.
 */
const LISTED = (name: string): string =>
  "Array.from(document.querySelectorAll('li')).some(function(l){" +
  "return (l.textContent||'').indexOf(" +
  JSON.stringify(name) +
  ")!==-1 && !!l.querySelector('a[href*=\"/attachments/\"]')})";

maybe(
  "picking a file uploads it, binds the reference, and saves",
  async () => {
    const page = await FlowBrowser.open(BASE + "/login");
    try {
      await signIn(page);
      // Its own issue, so this test and the two-window one below cannot land on
      // the same row and undo each other's work.
      const href = await createIssue(page, "Upload fixture " + Date.now());
      expect(href).not.toBe("");
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
        "!!document.body && document.body.textContent.indexOf(" +
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

/**
 * The file list is live, like the thread beside it — features 7 and 8.
 *
 * Two browsers, two sessions, one issue. The uploader appends locally; the
 * reader is told over the socket. Asserting from a second browser is the only
 * way to see the broadcast half: in the uploader's own page an appended row and
 * a broadcast row look identical, so a test with one window passes whether or
 * not anything ever left the process.
 */
maybe(
  "a file attached in one window appears in another without a reload",
  async () => {
    const uploader = await FlowBrowser.open(BASE + "/login");
    const reader = await FlowBrowser.open(BASE + "/login");
    try {
      await signIn(uploader);
      // Its own issue, authored by this user: the remove control is gated on
      // that, and a shared row made this test fight the one beside it.
      const href = await createIssue(uploader, "Live fixture " + Date.now());
      expect(href).not.toBe("");

      // The reader opens the same issue and then does nothing at all — no
      // navigation, no click. Anything that appears here arrived over the socket.
      await signIn(reader);
      await reader.goto(BASE + href);
      await reader.waitUntil(
        "!!document.querySelector('input[type=file]')",
        "the reader's page to settle",
        15000,
      );
      // The listeners are declared in the snapshot, but nothing subscribes until
      // the socket client exists — and it is loaded by a separate script, so a
      // page that looks ready can still be deaf. Waiting for it here is what
      // makes "the reader never saw it" mean the broadcast, not the bundle.
      await reader.waitUntil("!!window.Socket", "the reader's socket client", 60000);

      const NAME = "live-" + Date.now() + ".txt";
      expect(
        await reader.evaluate<boolean>(
          "!!document.body && document.body.textContent.indexOf(" + JSON.stringify(NAME) + ") !== -1",
        ),
      ).toBe(false);

      await pickFile(uploader, NAME);
      await uploader.waitUntil("!!(" + ATTACH_BTN + ")", "the reference to bind", 15000);

      // Clicks until the file is listed, rather than once. A single click is a
      // single chance: if the frame is dropped the page looks identical, and the
      // failure surfaces two waits later as "the reader never saw it" — pointing
      // at the broadcast, which was never given anything to carry.
      await uploader.waitUntil(
        "(function(){if(" + LISTED(NAME) + ")return true;var b=" + ATTACH_BTN +
          ";if(b)b.click();return false})()",
        "the file to be listed in the uploader's own window",
        30000,
      );

      await reader.waitUntil(
        LISTED(NAME),
        "the attachment to reach the second window over the socket",
        20000,
      );

      // And the other direction. A list that grows live but shrinks only on
      // reload leaves the reader a download link for a file that is gone, which
      // is the worse of the two states — so the removal travels too.
      // The row holding *this* file, not the first remove control on the page:
      // the dev database keeps earlier runs' attachments, and clicking the first
      // one deleted a stranger's file while the assertion waited for this one.
      await uploader.waitUntil(
        "(function(){var li=Array.from(document.querySelectorAll('li')).find(function(l){" +
          "return (l.textContent||'').indexOf(" +
          JSON.stringify(NAME) +
          ")!==-1});if(!li)return false;" +
          "var b=li.querySelector('button');if(!b)return false;" +
          "window.__clicked=(b.getAttribute('flow:click')||'(no flow:click)');" +
          "b.click();return true})()",
        "the remove control on this file's row",
        15000,
      );

      await Bun.sleep(4000);
      console.log("[after remove] uploader has file:", await uploader.evaluate(
        "!!document.body && document.body.textContent.indexOf(" + JSON.stringify(NAME) + ") !== -1"),
        "| reader has file:", await reader.evaluate(
        "!!document.body && document.body.textContent.indexOf(" + JSON.stringify(NAME) + ") !== -1"));
      console.log("[clicked]", await uploader.evaluate("String(window.__clicked)"));
      console.log("[uploader errors]", JSON.stringify(uploader.pageErrors()));
      console.log("[uploader console]", JSON.stringify(uploader.consoleErrors()));

      await reader.waitUntil(
        "!(" + LISTED(NAME) + ")",
        "the removal to reach the second window over the socket",
        20000,
      );

      expect(reader.pageErrors()).toEqual([]);
      expect(uploader.pageErrors()).toEqual([]);
    } finally {
      await reader.close();
      await uploader.close();
    }
  },
  180_000,
);
