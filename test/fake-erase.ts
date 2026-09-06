// The two PERMANENT doors, answered for a test: erasing rows for good, and destroying the
// treasury's storage under a credit-paid file.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-account.ts` HAS ONE: `check:size` measures `fake-drive.ts`.
//    The seam is the one the server draws — everything here refuses a bare key, exactly as the
//    server does, so a fake that answered without the proof could not fail for a tool that forgot
//    to send it.

import type { IncomingMessage, ServerResponse } from "node:http";

export interface EraseState {
  /** Every erase the tool asked for: the ids and whether a proof header travelled with it. */
  erasures: { ids: string[]; proof: string | null }[];
  /** Every storage release the tool asked for, in order. */
  releases: { id: string; proof: string | null }[];
  /** Item ids whose release the server refuses as "not the treasury's to destroy". */
  walletPaid: string[];
}

export const eraseState: EraseState = { erasures: [], releases: [], walletPaid: [] };

export function resetErase(): void {
  eraseState.erasures = [];
  eraseState.releases = [];
  eraseState.walletPaid = [];
}

/** Answer the request if it is one of the two doors; say whether it was. */
export function serveErase(method: string, url: string, req: IncomingMessage, res: ServerResponse): boolean {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const proofOf = (): string | null => {
    const h = req.headers["x-nmts-account-proof"];
    return typeof h === "string" ? h : null;
  };
  const refuse = (): void =>
    json(403, { error: { code: "ACCOUNT_PROOF_REQUIRED", message: "the NMTS key's proof is needed" } });

  if (method === "POST" && url === "/v1/items/erase") {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const body: unknown = raw === "" ? {} : JSON.parse(raw);
      const idsRaw: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "item_ids") : [];
      const ids = Array.isArray(idsRaw) ? idsRaw.filter((x): x is string => typeof x === "string") : [];
      const proof = proofOf();
      eraseState.erasures.push({ ids, proof });
      if (proof === null) return refuse();
      json(200, { erased: ids.length });
    });
    return true;
  }
  if (method === "POST" && /^\/v1\/items\/[^/]+\/release-storage$/.test(url)) {
    const id = decodeURIComponent(url.split("/")[3] ?? "");
    const proof = proofOf();
    eraseState.releases.push({ id, proof });
    if (proof === null) refuse();
    else if (eraseState.walletPaid.includes(id)) {
      json(409, { error: { code: "STORAGE_NOT_SPONSORED", message: "this storage was bought by the wallet, not by credits" } });
    } else json(200, { released: 1, already_released: 0, failed: 0, fee_credits: 0, tx_digests: ["D1"] });
    return true;
  }
  return false;
}
