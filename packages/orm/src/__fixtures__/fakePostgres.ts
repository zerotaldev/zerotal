/**
 * A PostgreSQL server that speaks just enough of the wire protocol for Bun's driver
 * to run a query against it, and answers every query with one row holding one
 * timestamp.
 *
 * It exists to see what the driver itself does — which result format it asks for,
 * and how it decodes what comes back — without a database: CI's PostgreSQL job
 * covers the real server, this covers the runtime on every machine.
 *
 * Every statement gets the same answer: a column named `column` of type `oid`
 * (1114 is `timestamp without time zone`) holding `iso`, sent as text or binary
 * as the driver's Bind asked.
 */
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function int32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n);
  return b;
}

function int16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setInt16(0, n);
  return b;
}

function cstring(s: string): Uint8Array {
  return concat(enc.encode(s), new Uint8Array([0]));
}

function message(type: string, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  return concat(enc.encode(type), int32(4 + body.length), body);
}

/** One query as the fake saw it. */
export interface FakePostgresExecution {
  /** The SQL text of the statement executed. */
  sql: string;
  /** How many `$n` parameters it has. */
  params: number;
  /** The result format the driver asked for. */
  format: "text" | "binary";
}

export interface FakePostgresOptions {
  column: string;
  oid: number;
  iso: string;
}

export interface FakePostgres {
  port: number;
  /** Every Execute and simple Query, in order. */
  executions: FakePostgresExecution[];
  stop(): void;
}

interface ConnState {
  started: boolean;
  buf: Uint8Array;
  statements: Map<string, string>;
  portalSql: string;
  binary: boolean;
}

/** Start a fake server on a free port. */
export function startFakePostgres(options: FakePostgresOptions): FakePostgres {
  const executions: FakePostgresExecution[] = [];
  const paramCount = (sql: string): number => new Set(sql.match(/\$\d+/g) ?? []).size;

  const rowDescription = (): Uint8Array =>
    message(
      "T",
      concat(
        int16(1),
        cstring(options.column),
        int32(0),
        int16(0),
        int32(options.oid),
        int16(8),
        int32(-1),
        int16(0),
      ),
    );

  const dataRow = (binary: boolean): Uint8Array => {
    if (binary) {
      const micros =
        (BigInt(Date.parse(options.iso)) - BigInt(Date.UTC(2000, 0, 1))) * 1000n;
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigInt64(0, micros);
      return message("D", concat(int16(1), int32(8), b));
    }
    const text = enc.encode(options.iso.replace("T", " ").replace(/(\.000)?Z$/, ""));
    return message("D", concat(int16(1), int32(text.length), text));
  };

  const server = Bun.listen<ConnState>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = {
          started: false,
          buf: new Uint8Array(0),
          statements: new Map(),
          portalSql: "",
          binary: false,
        };
      },
      data(socket, chunk) {
        const st = socket.data;
        st.buf = concat(st.buf, new Uint8Array(chunk));
        for (;;) {
          const view = new DataView(st.buf.buffer, st.buf.byteOffset, st.buf.byteLength);
          if (!st.started) {
            if (st.buf.length < 8) return;
            const len = view.getInt32(0);
            if (st.buf.length < len) return;
            const code = view.getInt32(4);
            st.buf = st.buf.slice(len);
            if (code === 80877103) {
              socket.write(enc.encode("N"));
              continue;
            }
            st.started = true;
            socket.write(
              concat(
                message("R", int32(0)),
                message("S", concat(cstring("server_version"), cstring("16.0"))),
                message("S", concat(cstring("client_encoding"), cstring("UTF8"))),
                message("K", concat(int32(1), int32(2))),
                message("Z", enc.encode("I")),
              ),
            );
            continue;
          }
          if (st.buf.length < 5) return;
          const type = String.fromCharCode(st.buf[0]!);
          const len = view.getInt32(1);
          if (st.buf.length < 1 + len) return;
          const body = st.buf.slice(5, 1 + len);
          st.buf = st.buf.slice(1 + len);
          const bodyView = new DataView(body.buffer, body.byteOffset, body.byteLength);
          const readCString = (at: number): [string, number] => {
            const end = body.indexOf(0, at);
            return [new TextDecoder().decode(body.subarray(at, end)), end + 1];
          };

          switch (type) {
            case "P": {
              const [name, next] = readCString(0);
              const [sql] = readCString(next);
              st.statements.set(name, sql);
              socket.write(message("1"));
              break;
            }
            case "D": {
              const [name] = readCString(1);
              if (body[0] === 83 /* S */) {
                const n = paramCount(st.statements.get(name) ?? "");
                const types = Array.from({ length: n }, () => int32(25));
                socket.write(concat(message("t", concat(int16(n), ...types)), rowDescription()));
              } else {
                socket.write(rowDescription());
              }
              break;
            }
            case "B": {
              const [, afterPortal] = readCString(0);
              const [statement, afterStatement] = readCString(afterPortal);
              let at = afterStatement;
              const paramFormats = bodyView.getInt16(at);
              at += 2 + 2 * paramFormats;
              const values = bodyView.getInt16(at);
              at += 2;
              for (let i = 0; i < values; i++) {
                const vlen = bodyView.getInt32(at);
                at += 4 + Math.max(vlen, 0);
              }
              const resultFormats = bodyView.getInt16(at);
              st.binary = resultFormats > 0 && bodyView.getInt16(at + 2) === 1;
              st.portalSql = st.statements.get(statement) ?? "";
              socket.write(message("2"));
              break;
            }
            case "E": {
              executions.push({
                sql: st.portalSql,
                params: paramCount(st.portalSql),
                format: st.binary ? "binary" : "text",
              });
              socket.write(concat(dataRow(st.binary), message("C", cstring("SELECT 1"))));
              break;
            }
            case "Q": {
              const [sql] = readCString(0);
              executions.push({ sql, params: 0, format: "text" });
              socket.write(
                concat(
                  rowDescription(),
                  dataRow(false),
                  message("C", cstring("SELECT 1")),
                  message("Z", enc.encode("I")),
                ),
              );
              break;
            }
            case "S":
              socket.write(message("Z", enc.encode("I")));
              break;
            case "C":
              socket.write(message("3"));
              break;
            case "X":
              socket.end();
              return;
            default:
              break;
          }
        }
      },
    },
  });

  return {
    port: server.port,
    executions,
    stop: () => server.stop(true),
  };
}
