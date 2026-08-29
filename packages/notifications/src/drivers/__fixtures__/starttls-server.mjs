/**
 * A STARTTLS-capable SMTP server, run under Node by `SmtpSubmission.test.ts`.
 *
 * Under Node and not Bun on purpose: the server side of a TLS upgrade means
 * wrapping a connected socket with `new TLSSocket(sock, { isServer: true })`, and
 * Bun does not support that. That limitation is the reason the submission flow
 * went untested for as long as it did — and it is a limitation of the *test*
 * harness, not of the client, so borrowing a runtime that can do it is enough.
 *
 * Plain `.mjs` so `node` runs it with no loader or install step.
 *
 * Usage: node starttls-server.mjs <cert.pem> <key.pem>
 * Prints the listening port on stdout, then one line per command received.
 */
import { createServer } from "node:net";
import { TLSSocket } from "node:tls";
import { readFileSync } from "node:fs";

const cert = readFileSync(process.argv[2]);
const key = readFileSync(process.argv[3]);

/** Speak enough SMTP to get a message accepted, over whichever stream we are given. */
function speakSmtp(stream, secure, upgrade) {
  let buffer = "";
  let inData = false;

  stream.on("error", () => {
    // A client that hangs up mid-session is the client's business, not a crash.
  });

  stream.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);

      if (inData) {
        if (line === ".") {
          inData = false;
          stream.write("250 2.0.0 Ok: queued\r\n");
        }
        continue;
      }

      console.log(`${secure ? "TLS" : "PLAIN"} ${line}`);
      const verb = (line.split(" ")[0] ?? "").toUpperCase();

      if (verb === "EHLO") {
        stream.write("250-localhost\r\n250-SIZE 10240000\r\n");
        // STARTTLS is only advertised while there is something to upgrade.
        if (!secure) stream.write("250-STARTTLS\r\n");
        stream.write("250-AUTH PLAIN LOGIN\r\n250 HELP\r\n");
      } else if (verb === "STARTTLS" && upgrade) {
        // Wait for the 220 to flush before wrapping: the ClientHello that follows
        // it must not land in the handler we are about to discard.
        stream.write("220 2.0.0 Ready to start TLS\r\n", () => upgrade());
        return;
      } else if (verb === "AUTH") {
        stream.write("235 2.7.0 Authentication successful\r\n");
      } else if (verb === "MAIL" || verb === "RCPT") {
        stream.write("250 2.1.0 Ok\r\n");
      } else if (verb === "DATA") {
        inData = true;
        stream.write("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (verb === "QUIT") {
        stream.write("221 2.0.0 Bye\r\n");
        stream.end();
      } else {
        stream.write("250 2.0.0 Ok\r\n");
      }
    }
  });
}

const server = createServer((socket) => {
  speakSmtp(socket, false, () => {
    socket.pause();
    socket.removeAllListeners("data");
    const tls = new TLSSocket(socket, { isServer: true, key, cert });
    tls.on("secure", () => console.log("SECURE"));
    speakSmtp(tls, true);
    socket.resume();
  });
  socket.write("220 localhost ESMTP ready\r\n");
});

server.listen(0, "127.0.0.1", () => {
  console.log(`PORT ${server.address().port}`);
});
