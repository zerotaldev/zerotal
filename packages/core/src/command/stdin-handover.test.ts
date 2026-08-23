/**
 * A command that prompts must give stdin back before anything else takes it.
 *
 * This is the bug behind a `zt dev` that died the instant the developer answered
 * the busy-port menu. Reading a prompt locks Bun's stdin stream, and the lock is
 * held for the life of the command so that a second prompt can still read — but
 * the very next thing on that path is the dev deck calling
 * `process.stdin.resume()`, which throws `ReadableStream is locked` against a
 * lock still held. The deck had already written the alternate-screen escape by
 * then, so its own restore wiped the error off the terminal on the way out. What
 * reached the developer was the startup banner, `exited with code 1`, and no
 * reason at all.
 *
 * Two properties, and the second is the one that is easy to get wrong: the lock
 * has to be *released*, not cancelled. Cancelling closes the underlying stdin, so
 * the deck takes over a terminal that then never delivers a keystroke — tab keys
 * and `q` dead, which is harder to diagnose than the crash it replaced.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { Command } from "./Command.ts";
import { BufferWriter } from "./OutputWriter.ts";

/** Exposes the protected handover, and nothing else. */
class Prompting extends Command {
  static commandName = "prompting";
  static description = "test double";
  async run(): Promise<void> {}
  handOver(): void {
    this.releaseStdin();
  }
}

function makeCommand(): Prompting {
  const command = new Prompting();
  command._writer = new BufferWriter();
  return command;
}

interface FakeStdin {
  stream: ReadableStream<Uint8Array>;
  wasCancelled: () => boolean;
}

/**
 * Stand in for stdin with a stream this file owns.
 *
 * The process's real stdin is shared with every other suite in the run, and one
 * of them holding a reader would decide whether these pass. It also cannot show
 * the difference that matters here: under `bun test` stdin is at EOF, so a
 * cancelled stream and a released one both read as done.
 */
let restore: (() => void) | undefined;

function fakeStdin(chunks: string[]): FakeStdin {
  const encoder = new TextEncoder();
  const queue = [...chunks];
  let wasCancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      // Nothing left: stay open with the read pending, the way a terminal
      // waiting to be typed at does. Closing here would look like a cancel.
      if (next !== undefined) controller.enqueue(encoder.encode(next));
    },
    cancel() {
      wasCancelled = true;
    },
  });

  const original = Bun.stdin.stream.bind(Bun.stdin);
  (Bun.stdin as unknown as { stream: () => ReadableStream<Uint8Array> }).stream = () => stream;
  restore = () => {
    (Bun.stdin as unknown as { stream: () => ReadableStream<Uint8Array> }).stream = original;
  };

  return { stream, wasCancelled: () => wasCancelled };
}

afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("releaseStdin", () => {
  it("frees the lock the prompt took, so the next owner can take stdin over", async () => {
    const stdin = fakeStdin(["2\n"]);
    const command = makeCommand();

    expect(await command._readLine()).toBe("2");
    expect(stdin.stream.locked).toBe(true);

    command.handOver();

    // The crash, as an assertion: against a held lock this throws
    // `ReadableStream is locked`, which is exactly what the deck hit.
    expect(stdin.stream.locked).toBe(false);
    expect(() => stdin.stream.getReader().releaseLock()).not.toThrow();
  });

  it("releases rather than cancels, so the next owner still hears the terminal", async () => {
    const stdin = fakeStdin(["2\n", "typed-after-the-handover\n"]);
    const command = makeCommand();

    await command._readLine();
    command.handOver();

    expect(stdin.wasCancelled()).toBe(false);

    // The part a cancel would break: input arriving after the handover has to
    // reach whoever holds the terminal now.
    const reader = stdin.stream.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    expect(new TextDecoder().decode(value)).toBe("typed-after-the-handover\n");
  });

  it("is safe to call when nothing ever prompted", () => {
    expect(() => makeCommand().handOver()).not.toThrow();
  });

  it("answers from the buffer instead of hanging once stdin has changed hands", async () => {
    fakeStdin(["2\n"]);
    const command = makeCommand();
    command.handOver();

    // Reopening Bun's stdin after a handover hangs rather than fails, and a hung
    // `zt dev` is worse than one that answers with nothing.
    const line = await Promise.race([command._readLine(), Bun.sleep(200).then(() => "HUNG")]);

    expect(line).toBe("");
  });
});

/**
 * The whole sequence, in a process whose stdin is a real fd.
 *
 * Everything above runs against a stream this file constructed. The failure was
 * in how Bun's actual stdin behaves when a reader lets go of it, and only a
 * child with a pipe on fd 0 can show that the deck's `process.stdin.resume()`
 * both stops throwing and still receives what is typed next.
 */
describe("prompt, hand over, take over — end to end", () => {
  const child = `
    const { Command } = await import(${JSON.stringify(
      Bun.pathToFileURL(join(import.meta.dir, "Command.ts")).href,
    )});
    class Prompting extends Command {
      static commandName = "prompting";
      static description = "";
      async run() {}
      handOver() { this.releaseStdin(); }
    }
    const command = new Prompting();
    console.log("PROMPT:" + (await command._readLine()));
    command.handOver();

    // What the dev deck does next, and what used to throw here.
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      console.log("DECK:" + chunk.toString().trim());
      process.exit(0);
    });
    console.log("TOOK-OVER");
    setTimeout(() => { console.log("DECK:<never arrived>"); process.exit(0); }, 4000);
  `;

  it("hands a working stdin to whatever takes the terminal next", async () => {
    const proc = Bun.spawn(["bun", "-e", child], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const writer = proc.stdin as unknown as {
      write: (data: string) => void;
      flush: () => void;
      end: () => void;
    };
    writer.write("2\n");
    writer.flush();

    // Written only once the handover is done, so it can only be read by the
    // second owner — which is the point.
    await Bun.sleep(700);
    writer.write("typed-after-the-handover\n");
    writer.flush();

    const output = await new Response(proc.stdout).text();
    const errors = await new Response(proc.stderr).text();
    await proc.exited;
    writer.end();

    expect(output).toContain("PROMPT:2");
    // No `ReadableStream is locked` — the crash was here.
    expect(errors).not.toContain("locked");
    expect(output).toContain("TOOK-OVER");
    // And a cancelled stdin would have left the new owner deaf.
    expect(output).toContain("DECK:typed-after-the-handover");
  }, 20_000);
});
