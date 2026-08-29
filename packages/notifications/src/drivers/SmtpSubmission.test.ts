/**
 * The whole submission flow on port 587: connect in the clear, EHLO, STARTTLS,
 * upgrade, EHLO again, authenticate, send.
 *
 * This is the test that was missing, and the bug it pins is the reason it was
 * missing. `SmtpStartTls.test.ts` covers the socket swap by upgrading into a peer
 * that is already speaking TLS, because Bun cannot be a STARTTLS *server* — and
 * the defect lived in the one step that arrangement skips. `upgradeTLS()` returns
 * the new socket while the handshake is still in flight, and a write issued in
 * that window is dropped: not buffered, not an error, gone. The `EHLO` that has to
 * follow STARTTLS went into that gap on every send.
 *
 * Everything either side of it looked healthy. The handshake completed, the server
 * logged a good TLS session and then a connection lost, and the client sat waiting
 * for a reply to a command it had never sent until the read timed out. Port 465 was
 * unaffected, because implicit TLS finishes before `Bun.connect()` resolves and
 * there is no window to write into — so mail worked on the port nobody documents,
 * and configuring the 587 that every provider does document produced silence. No
 * error, no bounce, no log line, and password resets that never arrived.
 *
 * The harness limitation was real and is not the client's: the server side of a TLS
 * upgrade means wrapping a connected socket with `new TLSSocket(sock, { isServer:
 * true })`, which Node does and Bun does not. So the peer runs under Node. That is
 * the only thing borrowed — the client under test is Zerotal's, on Bun, doing
 * exactly what it does against a real mail server.
 */
import { describe, it, expect, afterAll } from "bun:test";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmtpDriver } from "./SmtpDriver.ts";

/** Whether a command exists and runs. Both are external to the suite. */
function available(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const certificateDir = await mkdtemp(join(tmpdir(), "zt-smtp-submission-"));

/**
 * Generated rather than committed: a private key in the tree is a private key in
 * the tree, however loudly its filename says otherwise.
 */
const certificate = ((): { cert: string; key: string } | undefined => {
  try {
    execFileSync(
      "openssl",
      [
        ...["req", "-x509", "-newkey", "rsa:2048"],
        ...["-keyout", join(certificateDir, "key.pem")],
        ...["-out", join(certificateDir, "cert.pem")],
        ...["-days", "1", "-nodes", "-subj", "/CN=localhost"],
        ...["-addext", "subjectAltName=DNS:localhost"],
      ],
      { stdio: "ignore" },
    );
    return { cert: join(certificateDir, "cert.pem"), key: join(certificateDir, "key.pem") };
  } catch {
    return undefined;
  }
})();

const canRun = certificate !== undefined && available("node", ["--version"]);

const servers: ChildProcessWithoutNullStreams[] = [];

afterAll(async () => {
  for (const server of servers) server.kill();
  await rm(certificateDir, { recursive: true, force: true });
});

/**
 * Start the Node fixture server and wait for it to announce its port.
 *
 * @returns The port, and a `transcript()` of every command the server has seen.
 */
async function startServer(): Promise<{ port: number; transcript: () => string[] }> {
  const server = spawn(
    "node",
    [
      join(import.meta.dir, "__fixtures__", "starttls-server.mjs"),
      certificate!.cert,
      certificate!.key,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  servers.push(server);

  const lines: string[] = [];
  let pending = "";
  server.stdout.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    let index: number;
    while ((index = pending.indexOf("\n")) !== -1) {
      lines.push(pending.slice(0, index).trim());
      pending = pending.slice(index + 1);
    }
  });

  const deadline = Date.now() + 15_000;
  for (;;) {
    const announced = lines.find((line) => line.startsWith("PORT "));
    if (announced) return { port: Number(announced.slice(5)), transcript: () => [...lines] };
    if (Date.now() > deadline) throw new Error("fixture SMTP server never announced a port");
    await Bun.sleep(25);
  }
}

const message = {
  from: { address: "from@example.test", name: "From" },
  to: [{ address: "to@example.test" }],
  subject: "Submission",
  text: "body",
} as never;

describe.skipIf(!canRun)("SMTP submission over STARTTLS", () => {
  it("sends a message on a plaintext port that upgrades", async () => {
    const { port, transcript } = await startServer();
    const driver = new SmtpDriver("localhost", port, "user", "pass", false, {
      rejectUnauthorized: false,
      timeoutMs: 10_000,
    });

    await driver.send(message);

    const seen = transcript();
    // The command sequence is the assertion. Before the fix the transcript stopped
    // at STARTTLS — the handshake completed and nothing was ever sent over it.
    expect(seen).toContain("PLAIN STARTTLS");
    expect(seen).toContain("SECURE");
    expect(seen.filter((line) => line.startsWith("TLS EHLO"))).toHaveLength(1);
    expect(seen.some((line) => line.startsWith("TLS AUTH"))).toBe(true);
    expect(seen).toContain("TLS MAIL FROM:<from@example.test>");
    expect(seen).toContain("TLS RCPT TO:<to@example.test>");
    expect(seen).toContain("TLS DATA");
  }, 30_000);

  it("authenticates only after the upgrade, never in the clear", async () => {
    const { port, transcript } = await startServer();
    const driver = new SmtpDriver("localhost", port, "user", "pass", false, {
      rejectUnauthorized: false,
      timeoutMs: 10_000,
    });

    await driver.send(message);

    // `AUTH LOGIN` is base64, not encryption. Any AUTH on the plaintext stream
    // would be the credentials on the wire.
    expect(transcript().some((line) => line.startsWith("PLAIN AUTH"))).toBe(false);
  }, 30_000);

  it("refuses a certificate it cannot verify when asked to verify one", async () => {
    const { port } = await startServer();
    const driver = new SmtpDriver("localhost", port, "user", "pass", false, {
      rejectUnauthorized: true,
      timeoutMs: 10_000,
    });

    // The fixture's certificate is self-signed. Failing closed here is the point:
    // an upgrade that silently accepted anything would make STARTTLS decorative.
    await expect(driver.send(message)).rejects.toThrow(/STARTTLS upgrade failed|self.signed/i);
  }, 30_000);
});

/**
 * The same verification question on the other transport.
 *
 * `Bun.connect({ tls: { rejectUnauthorized: true } })` does not enforce it either —
 * it reports `authorized: true` for a self-signed certificate and puts the real
 * reason in `authorizationError` beside it. So implicit TLS was encrypted and would
 * have accepted that encryption from anyone in the path, which is the property TLS
 * exists to provide. This is the port a mail provider's documentation sends you to
 * when 587 does not work, so it is the one an app ends up pinned to.
 */
describe("implicit TLS verifies the certificate", () => {
  /** A TLS-from-the-first-byte SMTP server, which Bun *can* be. */
  async function tlsServer(): Promise<{ port: number; stop: () => void }> {
    let inData = false;
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: {
        cert: await Bun.file(certificate!.cert).text(),
        key: await Bun.file(certificate!.key).text(),
      },
      socket: {
        open: (s) => void s.write(new TextEncoder().encode("220 localhost ESMTP\r\n")),
        data: (s, d) => {
          const reply = (text: string): void => void s.write(new TextEncoder().encode(text));
          const chunk = new TextDecoder().decode(d);
          if (inData) {
            // The message body, terminated by a bare dot on its own line.
            if (/(^|\r\n)\.\r\n/.test(chunk)) {
              inData = false;
              reply("250 2.0.0 Ok: queued\r\n");
            }
            return;
          }
          const verb = chunk.trim().split(" ")[0]?.toUpperCase();
          if (verb === "EHLO") reply("250 localhost\r\n");
          else if (verb === "DATA") {
            inData = true;
            reply("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (verb === "QUIT") reply("221 2.0.0 Bye\r\n");
          else reply("250 2.0.0 Ok\r\n");
        },
        error: () => {},
        close: () => {},
      },
    });
    return { port: server.port, stop: () => server.stop(true) };
  }

  it.skipIf(!certificate)(
    "refuses a self-signed certificate by default",
    async () => {
      const { port, stop } = await tlsServer();
      try {
        const driver = new SmtpDriver("localhost", port, "", "", true, { timeoutMs: 8000 });
        await expect(driver.send(message)).rejects.toThrow(
          /TLS connection|self.signed|certificate/i,
        );
      } finally {
        stop();
      }
    },
    30_000,
  );

  it.skipIf(!certificate)(
    "accepts one when told to, which is what that flag is for",
    async () => {
      const { port, stop } = await tlsServer();
      try {
        const driver = new SmtpDriver("localhost", port, "", "", true, {
          rejectUnauthorized: false,
          timeoutMs: 8000,
        });
        // The fixture answers 250 to everything, so getting past the handshake and
        // through the conversation is the assertion.
        await driver.send(message);
      } finally {
        stop();
      }
    },
    30_000,
  );
});
