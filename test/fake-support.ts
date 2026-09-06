// The four support routes, answered the way the real ones do.
//
// ⛔ ITS OWN SERVER, NOT MORE OF `fake-drive.ts`. That file is already past the length gate, and a
//    harness that makes an over-long file longer makes somebody else's job harder. Nothing is
//    lost by the split: `nmts support` needs no file list, no item rows and no account code, so
//    there is nothing here for the drive to hold.
//
// ⛔ IT REFUSES WHAT THE REAL ROUTES REFUSE, and the refusals are the point of most of the tests:
//    a 429 carrying `Retry-After` in the HEADER (which is the only place the server puts it), a
//    409 for the same message twice, a 400 `VALIDATION` naming the field that was wrong, and a
//    404 for a report this rail did not file. A fake that answered 200 to everything could not
//    fail for a command that read any of them wrongly.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** One message in a thread, in the server's own spelling. */
export interface SupportMessageRow {
  id: string;
  from_operator: boolean;
  kind: number;
  body: string;
  created_at: string;
  deleted_at?: string;
}

/** One ticket, in the server's own spelling. */
export interface SupportTicketRow {
  id: string;
  code: string;
  category: string;
  subcategory?: string;
  message: string;
  status: string;
  created_at: string;
  last_read_at: string | null;
  /** What the CLI attached, kept so a test can assert what actually travelled. */
  log?: string;
  messages: SupportMessageRow[];
}

/** A refusal to answer with instead of doing the work. */
export interface SupportRefusal {
  status: number;
  code: string;
  message: string;
  /** Seconds, sent as the `Retry-After` header and nowhere else — exactly as the server does it. */
  retryAfter?: number;
}

export interface FakeSupport {
  tickets: SupportTicketRow[];
  unread: number;
  /** Answer the next write with this instead of doing it. Cleared by `reset`, not by use. */
  refuse: SupportRefusal | null;
  /** Every body the tool posted, in order, so a test can read what actually left. */
  posted: { path: string; body: unknown }[];
  reset(): void;
  /** Answer this request, or say it is not one of ours. */
  handle(req: IncomingMessage, res: ServerResponse, method: string, url: string): boolean;
}

const ROOT = "/v1/support/cli";

export function fakeSupport(): FakeSupport {
  const state: FakeSupport = {
    tickets: [],
    unread: 0,
    refuse: null,
    posted: [],
    reset(): void {
      state.tickets = [];
      state.unread = 0;
      state.refuse = null;
      state.posted = [];
    },
    handle(req, res, method, url): boolean {
      if (url !== ROOT && !url.startsWith(`${ROOT}/`)) return false;
      const json = (status: number, body: unknown, headers: Record<string, string> = {}): void => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(body));
      };
      const refused = (): boolean => {
        const r = state.refuse;
        if (r === null) return false;
        json(
          r.status,
          { error: { code: r.code, message: r.message } },
          r.retryAfter === undefined ? {} : { "retry-after": String(r.retryAfter) },
        );
        return true;
      };

      if (method === "GET" && url === ROOT) {
        return answer(json, {
          tickets: state.tickets.map(withoutThread),
          remaining_open: 10,
          unread: state.unread,
        });
      }
      if (method === "GET") {
        const id = url.slice(`${ROOT}/`.length);
        const found = state.tickets.find((t) => t.id === id);
        if (found === undefined) return answer(json, notFound(), 404);
        // Reading marks it read, exactly as the route does.
        found.last_read_at = "2026-09-04T12:00:00Z";
        // ⚠ `log` is what the test keeps, not what the server sends back. A fake that answered a
        //   field the real route has no column for would let a reader depend on one.
        const { log: _kept, ...thread } = found;
        return answer(json, thread);
      }
      if (method === "POST" && url === ROOT) {
        readBody(req, (body) => {
          state.posted.push({ path: url, body });
          if (refused()) return;
          const at = (name: string): unknown =>
            typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined;
          const sub = at("subcategory");
          const log = at("log");
          const created: SupportTicketRow = {
            id: `00000000-0000-4000-8000-${String(state.tickets.length + 1).padStart(12, "0")}`,
            code: `NM${state.tickets.length + 1}`,
            category: String(at("category")),
            ...(typeof sub === "string" ? { subcategory: sub } : {}),
            message: String(at("message")),
            status: "open",
            created_at: "2026-09-04T11:00:00Z",
            last_read_at: null,
            ...(typeof log === "string" ? { log } : {}),
            messages: [],
          };
          state.tickets.push(created);
          json(201, withoutThread(created));
        });
        return true;
      }
      if (method === "POST" && url.endsWith("/reply")) {
        const id = url.slice(`${ROOT}/`.length, url.length - "/reply".length);
        readBody(req, (body) => {
          state.posted.push({ path: url, body });
          if (refused()) return;
          const found = state.tickets.find((t) => t.id === id);
          if (found === undefined) return json(404, notFound());
          // ⚠ `body`, not `message`: only a thread's first message is called a message.
          const said: unknown =
            typeof body === "object" && body !== null ? Reflect.get(body, "body") : undefined;
          found.messages.push({
            id: `m${found.messages.length + 1}`,
            from_operator: false,
            kind: 0,
            body: String(said),
            created_at: "2026-09-04T11:30:00Z",
          });
          json(201, found);
        });
        return true;
      }
      return answer(json, notFound(), 404);
    },
  };
  return state;
}

type Json = (status: number, body: unknown, headers?: Record<string, string>) => void;

function answer(json: Json, body: unknown, status = 200): boolean {
  json(status, body);
  return true;
}

function notFound(): unknown {
  return { error: { code: "NOT_FOUND", message: "no such report" } };
}

/** The list route sends no thread — only the thread route fills one in. */
function withoutThread(row: SupportTicketRow): unknown {
  const { messages: _thread, log: _log, ...rest } = row;
  return rest;
}

function readBody(req: IncomingMessage, then: (body: unknown) => void): void {
  let raw = "";
  req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
  req.on("end", () => {
    let parsed: unknown = null;
    try {
      parsed = raw === "" ? null : JSON.parse(raw);
    } catch {
      parsed = null;
    }
    then(parsed);
  });
}

/** The same routes, on a loopback address of their own. */
export interface FakeSupportServer extends FakeSupport {
  readonly base: string;
  close(): void;
}

export async function startFakeSupport(): Promise<FakeSupportServer> {
  const desk = fakeSupport();
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (desk.handle(req, res, req.method ?? "GET", url)) return;
    // ⚠ Nothing else is answered. A fake that replied to any address at all would prove the tool
    //   agrees with the test rather than with the server (`check:cli-routes` exists for that).
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such route" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address !== "object") throw new Error("test server did not bind a port");
  return Object.assign(desk, { base: `http://127.0.0.1:${address.port}`, close: (): void => void server.close() });
}
