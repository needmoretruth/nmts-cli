// The public-code doors, answered for a test.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-erase.ts` HAS ONE: `check:size` measures `fake-drive.ts`,
//    and the command tests that need nothing else start it on a server of their own.
//
// ⛔ IT KEEPS THE RULES A CLIENT CAN BREAK: the next number is the highest ever plus one, a revoked
//    address is refused for ever, the live ceiling, the day ceiling, and the last live code. A fake
//    that accepted any number could not fail for a client that sent the wrong one.
//
// ⚠ WHAT IT IS NOT. It does not verify the identity bundle against the address — the server does,
//   and is tested where it is. What it stores is what the client sent, so a test can compare that
//   with what the key derives.

import type { IncomingMessage, ServerResponse } from "node:http";

export interface FakeCode {
  index: number;
  address: string;
  created_at: string;
  revoked_at: string | null;
  sent: number;
  received: number;
  support: number;
}

export interface PublicCodesState {
  codes: FakeCode[];
  liveMax: number;
  dayCap: number;
  madeToday: number;
  /** Addresses (base64url) whose code was revoked once — refused for ever, even with no code row. */
  revokedAddresses: Set<string>;
  /** Refuse the next publish with this, whatever it carried. */
  refuseNext: { status: number; code: string; details?: Record<string, number> } | null;
  /** Every publish that arrived, in order, as sent. */
  posts: { index: number; identity: string; address: string; revoke?: number[] }[];
  /** Every revoke that arrived, by number. */
  revokes: number[];
  /** What `GET /v1/shares/sent?from_index=N` answers: rows carrying `from_index`, filtered by it. */
  sentFrom: Record<string, unknown>[];
  /** What `GET /v1/shares/received` answers. */
  received: unknown[];
  /** `GET /v1/share-recipients/{address}`: the identity published at an address, or "revoked". */
  recipients: Map<string, string>;
  /** Every `POST /v1/shares` body, as sent. */
  sharesPosted: Record<string, unknown>[];
}

export const publicCodesState: PublicCodesState = {
  codes: [],
  liveMax: 3,
  dayCap: 10,
  madeToday: 0,
  revokedAddresses: new Set(),
  refuseNext: null,
  posts: [],
  revokes: [],
  sentFrom: [],
  received: [],
  recipients: new Map(),
  sharesPosted: [],
};

export function resetPublicCodes(): void {
  publicCodesState.codes = [];
  publicCodesState.liveMax = 3;
  publicCodesState.dayCap = 10;
  publicCodesState.madeToday = 0;
  publicCodesState.revokedAddresses = new Set();
  publicCodesState.refuseNext = null;
  publicCodesState.posts = [];
  publicCodesState.revokes = [];
  publicCodesState.sentFrom = [];
  publicCodesState.received = [];
  publicCodesState.recipients = new Map();
  publicCodesState.sharesPosted = [];
}

const REVOKE = /^\/v1\/account\/public-codes\/([0-9]+)\/revoke$/;

/** Answer the request if it is one of the public-code doors; say whether it was. */
export function servePublicCodes(method: string, url: string, req: IncomingMessage, res: ServerResponse): boolean {
  const [path = "", query = ""] = url.split("?");
  // ⚠ Only the by-code form of the sent listing; `?item_id=` stays `fake-drive.ts`'s.
  if (method === "GET" && path === "/v1/shares/sent" && query.startsWith("from_index=")) {
    const from = Number(query.slice("from_index=".length));
    return send(res, { shares: publicCodesState.sentFrom.filter((r) => r["from_index"] === from) });
  }
  if (method === "GET" && path === "/v1/shares/received") {
    return send(res, { shares: publicCodesState.received, total: publicCodesState.received.length });
  }
  // The two doors a share goes through: the recipient's published identity, and the share itself.
  if (method === "GET" && path.startsWith("/v1/share-recipients/")) {
    const held = publicCodesState.recipients.get(decodeURIComponent(path.slice("/v1/share-recipients/".length)));
    if (held === "revoked") return refuseWith(res, 410, "PUBLIC_CODE_REVOKED");
    return held === undefined ? refuseWith(res, 404, "NOT_FOUND") : send(res, { share_public_key: held });
  }
  if (method === "POST" && path === "/v1/shares") {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      const parsed: unknown = JSON.parse(body);
      const row: Record<string, unknown> = typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
      publicCodesState.sharesPosted.push(row);
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "sh-new", recipient_address: row["recipient_address"] }));
    });
    return true;
  }
  if (path !== "/v1/account/public-codes" && !REVOKE.test(path)) return false;
  let raw = "";
  req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
  req.on("end", () => answer(method, path, res, raw));
  return true;
}

function send(res: ServerResponse, body: unknown): true {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
  return true;
}

function refuseWith(res: ServerResponse, status: number, code: string): true {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code, message: code.toLowerCase().replace(/_/g, " ") } }));
  return true;
}

function answer(method: string, path: string, res: ServerResponse, raw: string): void {
  const s = publicCodesState;
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const refuse = (status: number, code: string, details?: Record<string, number>): void =>
    json(status, { error: { code, message: code.toLowerCase().replace(/_/g, " "), ...(details ? { details } : {}) } });
  const live = (): FakeCode[] => s.codes.filter((c) => c.revoked_at === null);

  if (method === "GET" && path === "/v1/account/public-codes") {
    return json(200, { codes: s.codes, live_max: s.liveMax, day_cap: s.dayCap, made_today: s.madeToday });
  }
  const revoking = REVOKE.exec(path);
  if (method === "POST" && revoking !== null) {
    const index = Number(revoking[1]);
    const row = s.codes.find((c) => c.index === index);
    if (row === undefined) return refuse(404, "NOT_FOUND");
    if (row.revoked_at === null && live().length <= 1) return refuse(409, "LAST_LIVE_CODE");
    s.revokes.push(index);
    row.revoked_at ??= "2026-09-24T00:00:00Z";
    s.revokedAddresses.add(row.address);
    res.writeHead(204);
    res.end();
    return;
  }
  if (method === "POST" && path === "/v1/account/public-codes") {
    const body: unknown = JSON.parse(raw);
    const at = (name: string): unknown => (typeof body === "object" && body !== null ? Reflect.get(body, name) : undefined);
    const index = at("index");
    const identity = at("identity");
    const address = at("address");
    const revoke = at("revoke");
    if (typeof index !== "number" || typeof identity !== "string" || typeof address !== "string") {
      return refuse(400, "VALIDATION");
    }
    const revokes = Array.isArray(revoke) ? revoke.filter((n): n is number => typeof n === "number") : [];
    s.posts.push({ index, identity, address, ...(Array.isArray(revoke) ? { revoke: revokes } : {}) });
    if (s.refuseNext !== null) {
      const r = s.refuseNext;
      s.refuseNext = null;
      return refuse(r.status, r.code, r.details);
    }
    if (s.revokedAddresses.has(address)) return refuse(410, "PUBLIC_CODE_REVOKED");
    const next = s.codes.reduce((top, c) => Math.max(top, c.index + 1), 0);
    if (s.codes.length > 0 && index !== next) return refuse(409, "INDEX_NOT_NEXT", { next });
    if (live().length - revokes.length + 1 > s.liveMax) return refuse(409, "TOO_MANY_LIVE_CODES", { cap: s.liveMax });
    if (s.madeToday >= s.dayCap) return refuse(429, "PUBLIC_CODE_DAY_CAP", { cap: s.dayCap });
    for (const n of revokes) {
      const row = s.codes.find((c) => c.index === n);
      if (row !== undefined) {
        row.revoked_at = "2026-09-24T00:00:00Z";
        s.revokedAddresses.add(row.address);
      }
    }
    s.codes.push({ index, address, created_at: "2026-09-24T00:00:00Z", revoked_at: null, sent: 0, received: 0, support: 0 });
    s.madeToday += 1;
    return json(201, { index, address });
  }
  refuse(404, "NOT_FOUND");
}
