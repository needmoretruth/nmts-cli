// The public-link doors (NCF-3 §5.8), answered for a test: make, list, cut, and the public read.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-erase.ts` HAS ONE: `check:size` measures `fake-drive.ts`.
//    The public read carries no credential and the other three do, exactly as the server draws it,
//    so a fake that answered the read to a bearer could not fail for a tool that sent one.

import type { IncomingMessage, ServerResponse } from "node:http";

export interface LinkRow {
  /** The body the tool sent, as it sent it. */
  body: Record<string, unknown>;
  id: string;
  cut: boolean;
  /** The credential it was made under — `nmts_ak1_…` or `nmts_dt1_…`. */
  bearer: string | null;
}

export interface LinkState {
  rows: LinkRow[];
  /** What the public read answers beside the envelopes: `{ size, parts }`, the server's spelling. */
  parts: unknown;
  /** Every public read, and whether it carried an `Authorization` header. */
  reads: { id: string; bearer: boolean }[];
}

export const linkState: LinkState = { rows: [], parts: { size: 0, parts: [] }, reads: [] };

export function resetLinks(): void {
  linkState.rows = [];
  linkState.parts = { size: 0, parts: [] };
  linkState.reads = [];
}

/** A token of the real shape (16 bytes, base64url), different per row. */
const tokenOf = (n: number): string => `LinkToken${String(n).padStart(4, "0")}AbCdEfGhI`;

/** A live row as the account-wide list answers it. */
const ownedView = (r: LinkRow): Record<string, unknown> => ({
  link_id: r.id,
  item_id: r.body["item_id"],
  owner_secret: r.body["owner_secret"],
  disclosed_name: r.body["disclosed_name"],
  created_at: "2026-09-26T00:00:00Z",
  ...(r.body["expires_at"] === undefined ? {} : { expires_at: r.body["expires_at"] }),
  downloads: 0,
});

/** Answer the request if it is one of the link doors; say whether it was. */
export function serveLinks(method: string, url: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (!url.startsWith("/v1/share-links")) return false;
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const auth = req.headers["authorization"];
  const bearer = typeof auth === "string" ? auth.replace(/^Bearer /, "") : null;
  const find = (id: string): LinkRow | undefined => linkState.rows.find((r) => r.id === id);

  if (method === "POST" && url === "/v1/share-links") {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const body: unknown = JSON.parse(raw);
      if (typeof body !== "object" || body === null) return json(400, { error: { code: "VALIDATION", message: "no body" } });
      const row: LinkRow = { body: { ...body }, id: tokenOf(linkState.rows.length + 1), cut: false, bearer };
      linkState.rows.push(row);
      json(201, { link_id: row.id, created_at: "2026-09-26T00:00:00Z", expires_at: row.body["expires_at"] ?? null });
    });
    return true;
  }
  // The account-wide doors: every live link, and the cut of all of them in one request.
  if (method === "GET" && url === "/v1/share-links/live") {
    json(200, { links: linkState.rows.filter((r) => !r.cut).map((r) => ownedView(r)).reverse() });
    return true;
  }
  if (method === "DELETE" && url === "/v1/share-links") {
    const live = linkState.rows.filter((r) => !r.cut);
    for (const r of live) r.cut = true;
    json(200, { cut: live.length });
    return true;
  }
  if (method === "GET" && url.startsWith("/v1/share-links?")) {
    const item = new URL(url, "http://x").searchParams.get("item_id");
    const links = linkState.rows
      .filter((r) => r.body["item_id"] === item)
      .map((r) => ({
        link_id: r.id,
        item_id: item,
        owner_secret: r.body["owner_secret"],
        disclosed_name: r.body["disclosed_name"],
        created_at: "2026-09-26T00:00:00Z",
        expires_at: r.body["expires_at"] ?? null,
        downloads: 0,
        ...(r.cut ? { revoked_at: "2026-09-26T01:00:00Z", revoked_by: "owner" } : {}),
      }));
    json(200, { links });
    return true;
  }
  const id = decodeURIComponent(url.slice("/v1/share-links/".length));
  const row = find(id);
  if (method === "DELETE") {
    if (row === undefined) return (json(404, { error: { code: "NOT_FOUND", message: "no such link" } }), true);
    row.cut = true;
    res.writeHead(204);
    res.end();
    return true;
  }
  if (method === "GET") {
    linkState.reads.push({ id, bearer: bearer !== null });
    if (row === undefined) return (json(404, { error: { code: "NOT_FOUND", message: "no such link" } }), true);
    if (row.cut) return (json(410, { error: { code: "LINK_GONE", message: "gone" } }), true);
    const parts = typeof linkState.parts === "object" && linkState.parts !== null ? linkState.parts : {};
    json(200, { link_id: id, wrapped: row.body["wrapped"], name: row.body["name"], hash: row.body["hash"], ...parts });
    return true;
  }
  return false;
}
