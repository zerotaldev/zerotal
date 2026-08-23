/**
 * A STARTTLS upgrade replaces the stream; the plaintext socket does not go away.
 *
 * `upgradeTLS()` hands back a new socket and leaves the old one attached, still
 * firing its callbacks — and what it delivers from then on is the *undecrypted*
 * TLS stream. Both sets of handlers fed one reply buffer, so handshake records
 * and ciphertext were interleaved with the server's replies. The `250` after
 * STARTTLS was never parsed, every send died on the read timeout, and the server
 * logged a connection lost after STARTTLS. No mail could be sent over port 587 at
 * all.
 *
 * The measurement that settles it: after an upgrade, the discarded socket's
 * handler received 1,737 bytes of ciphertext while the TLS handler received the
 * replies. Both were being appended to the same buffer.
 *
 * ## The shape of these tests
 *
 * A STARTTLS negotiation cannot be faked in process — Bun answers
 * "Server-side upgradeTLS is not supported", so no fake server gets past the
 * 220. What matters is not the negotiation but what follows it: a client socket
 * upgrading into a peer that is already speaking TLS exercises exactly the same
 * `upgradeTLS()` call, the same two live handlers, and the same shared buffer.
 * So the peer here is TLS from its first byte and the client upgrades straight
 * into it.
 *
 * Getting the reply out intact is the whole assertion. Before the fix the buffer
 * held binary, and nothing that went into it came back as a reply.
 */
import { describe, it, expect, afterAll, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SmtpConnection } from "./SmtpDriver.ts";

/**
 * Built at module scope, not in `beforeAll` — `skipIf` below is evaluated while
 * the file is loading, so anything it consults has to exist by then.
 *
 * Generated rather than committed: a private key in the tree is a private key in
 * the tree, however loudly its filename says otherwise.
 */
const certificateDir = await mkdtemp(join(tmpdir(), "zt-smtp-tls-"));
const certificate = await (async (): Promise<{ cert: string; key: string } | undefined> => {
  try {
    execFileSync(
      "openssl",
      [
        ...["req", "-x509", "-newkey", "rsa:2048"],
        ...["-keyout", join(certificateDir, "key.pem")],
        ...["-out", join(certificateDir, "cert.pem")],
        ...["-days", "1", "-nodes", "-subj", "/CN=localhost"],
      ],
      { stdio: "ignore" },
    );
    return {
      cert: await Bun.file(join(certificateDir, "cert.pem")).text(),
      key: await Bun.file(join(certificateDir, "key.pem")).text(),
    };
  } catch {
    // No openssl here. Skipped rather than failed: a transport suite must not
    // depend on what happens to be installed beside it.
    return undefined;
  }
})();

afterAll(async () => {
  await rm(certificateDir, { recursive: true, force: true }).catch(() => undefined);
});

interface Peer {
  port: number;
  say(line: string): void;
  stop(): void;
}

/** An SMTP peer that is TLS from its first byte. */
function tlsPeer(): Peer {
  let client: { write: (data: string) => void } | undefined;

  const server = Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    tls: certificate!,
    socket: {
      // Fires once the handshake is done, which is the moment a real server
      // starts talking.
      open(socket) {
        client = socket as unknown as typeof client;
        socket.write("220 peer ESMTP ready\r\n");
      },
      data(socket, raw) {
        if (new TextDecoder().decode(raw).startsWith("EHLO")) {
          socket.write("250-peer\r\n250-SIZE 10240000\r\n250 HELP\r\n");
        }
      },
    },
  });

  return {
    port: server.port,
    say: (line) => client?.write(`${line}\r\n`),
    stop: () => server.stop(true),
  };
}

const peers: Peer[] = [];
afterEach(() => {
  while (peers.length) peers.pop()!.stop();
});

/** Connect in the clear, then upgrade — the second half of a STARTTLS session. */
async function upgraded(): Promise<{ conn: SmtpConnection; server: Peer }> {
  const server = tlsPeer();
  peers.push(server);

  const conn = await SmtpConnection.open("127.0.0.1", server.port, {
    tls: false,
    rejectUnauthorized: false,
    timeoutMs: 3_000,
  });
  await conn.upgradeTLS("127.0.0.1", false);

  return { conn, server };
}

describe.skipIf(!certificate)("after an upgrade", () => {
  it("reads the server's reply instead of the ciphertext beside it", async () => {
    const { conn } = await upgraded();

    // This is the read that used to time out. The handshake records were landing
    // in the same buffer, so no line in it ever matched a reply.
    const greeting = await conn.expect(220);

    expect(greeting.code).toBe(220);
    expect(greeting.text).toContain("peer ESMTP ready");
    conn.close();
  });

  it("frames a multi-line reply, which a polluted buffer cannot", async () => {
    const { conn } = await upgraded();
    await conn.expect(220);

    // Capability lines are how the driver learns whether it may authenticate at
    // all. One stray byte in the buffer and the reply either never terminates or
    // terminates in the wrong place.
    conn.send("EHLO zerotal");
    const reply = await conn.expect(250);

    expect(reply.lines).toEqual(["250-peer", "250-SIZE 10240000", "250 HELP"]);
    conn.close();
  });

  it("stays open, rather than ending with the socket it replaced", async () => {
    const { conn, server } = await upgraded();
    await conn.expect(220);

    // The plaintext socket ending is part of handing over to TLS. Counting it as
    // the connection dropping rejected whatever was waiting on the session that
    // had just replaced it.
    await Bun.sleep(150);
    server.say("250 STILL-HERE");

    const reply = await conn.read();
    expect(reply.code).toBe(250);
    expect(reply.text).toContain("STILL-HERE");
    conn.close();
  });

  it("reports itself encrypted", async () => {
    // What decides whether credentials may be sent at all.
    const { conn } = await upgraded();
    expect(conn.encrypted).toBe(true);
    conn.close();
  });
});
