// The four opener doors, answered for a test.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-erase.ts` HAS ONE: `check:size` measures `fake-drive.ts`.
//
// ⛔ IT REFUSES A CREDENTIAL THAT ARRIVES WITHOUT THE ACCOUNT CODE'S PROOF, exactly as the server
//    does on all three account doors — so a client that forgot to send it cannot pass here. And the
//    fourth door takes nothing at all and answers RAW BYTES, which is what the real one answers: a
//    fake that sent JSON there would hide a reader that decoded the slot as text.
//
// ⛔ THE CAP IS REAL. Storing one opener too many answers the server's own refusal, so the advice
//    for it is reachable from a test rather than only from a live account with eight wallets.

import type { IncomingMessage, ServerResponse } from "node:http";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

export interface OpenerState {
  /** Every slot the server holds, by locator — the one thing the sessionless door answers. */
  slots: Map<string, { accountId: string | null; kind: number; slot: Uint8Array; createdAt: string }>;
  /** Every request the three account doors took, with the proof and credential that came with it. */
  calls: { method: string; locator: string | null; proof: string | null; bearer: string | null }[];
  /** How many openers one account may hold here. The real server's number is 8. */
  cap: number;
}

export const openerState: OpenerState = { slots: new Map(), calls: [], cap: 8 };

export function resetOpeners(): void {
  openerState.slots = new Map();
  openerState.calls = [];
  openerState.cap = 8;
}

/**
 * A wallet a test can drive: a real keypair, asked for real signatures over what it is handed.
 *
 * ⛔ HERE RATHER THAN IN EACH TEST that needs one, because the SDK's tests cannot import the chain
 *    library at all — it is this package's dependency, not theirs — and a fake signer would prove
 *    that our code agrees with itself rather than that a wallet's own bytes open a slot.
 *
 * ⚠ A SEED FIXES THE LOCATOR. Ed25519 signs the same bytes the same way every time, so the same
 *   seed always reaches the same name — which the tests that TYPE a locator on a command line need:
 *   about one locator in 64 begins with `-`, and that one is an option name to any shell and to
 *   this tool's parser until `--` ends the options. Without a seed the keypair is random, which is
 *   what the tests that only care that a real wallet's bytes work should use.
 */
export function testWallet(seed?: Uint8Array): {
  address: string;
  sign: (message: Uint8Array) => Promise<{ signature: string; bytes: string }>;
} {
  const keypair = seed === undefined ? new Ed25519Keypair() : Ed25519Keypair.fromSecretKey(seed);
  return { address: keypair.toSuiAddress(), sign: (message) => keypair.signPersonalMessage(message) };
}

/** The 32 bytes `testWallet` takes, written as one small number so a test can name which wallet. */
export function walletSeed(n: number): Uint8Array {
  const seed = new Uint8Array(32);
  seed[0] = n & 0xff;
  seed[1] = (n >> 8) & 0xff;
  return seed;
}

/** Answer the request if it is one of the four doors; say whether it was. */
export function serveOpeners(method: string, url: string, req: IncomingMessage, res: ServerResponse): boolean {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const header = (name: string): string | null => {
    const value = req.headers[name];
    return typeof value === "string" ? value : null;
  };
  const proofOf = (): string | null => header("x-nmts-account-proof");
  const bearerOf = (): string | null => header("authorization")?.replace(/^Bearer /, "") ?? null;
  const refuse = (): void =>
    json(403, { error: { code: "ACCOUNT_PROOF_REQUIRED", message: "the NMTS key's proof is needed" } });
  const notFound = (): void => json(404, { error: { code: "NOT_FOUND", message: "no such opener" } });

  // ⛔ FIRST, because the singular path is a prefix of nothing but itself and the plural one is
  //    matched below. This is the only door here that takes no credential.
  const fetching = /^\/v1\/opener\/([^/?]+)$/.exec(url);
  if (method === "GET" && fetching !== null) {
    const held = openerState.slots.get(decodeURIComponent(fetching[1] ?? ""));
    if (held === undefined) return notFound(), true;
    res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "private, no-store" });
    res.end(Buffer.from(held.slot));
    return true;
  }

  if (method === "GET" && url === "/v1/openers") {
    const proof = proofOf();
    openerState.calls.push({ method, locator: null, proof, bearer: bearerOf() });
    if (proof === null) return refuse(), true;
    json(200, {
      openers: [...openerState.slots.entries()].map(([locator, held]) => ({
        locator,
        kind: held.kind,
        created_at: held.createdAt,
      })),
      cap: openerState.cap,
    });
    return true;
  }

  const named = /^\/v1\/openers\/([^/?]+)$/.exec(url);
  if (named === null) return false;
  const locator = decodeURIComponent(named[1] ?? "");

  if (method === "PUT") {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
    req.on("end", () => {
      const proof = proofOf();
      openerState.calls.push({ method, locator, proof, bearer: bearerOf() });
      if (proof === null) return refuse();
      const body: unknown = raw === "" ? {} : JSON.parse(raw);
      const kind: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "kind") : undefined;
      const slot: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "slot") : undefined;
      if (typeof slot !== "string" || typeof kind !== "number") {
        return json(400, { error: { code: "VALIDATION", message: "slot: must be base64url bytes" } });
      }
      if (!openerState.slots.has(locator) && openerState.slots.size >= openerState.cap) {
        return json(409, {
          error: {
            code: "OPENER_CAP",
            message: `this account holds ${openerState.cap} openers, which is as many as it may`,
            details: { cap: openerState.cap, live: openerState.slots.size },
          },
        });
      }
      openerState.slots.set(locator, {
        accountId: null,
        kind,
        slot: Buffer.from(slot.replace(/-/g, "+").replace(/_/g, "/"), "base64"),
        createdAt: "2026-09-20T00:00:00Z",
      });
      res.writeHead(204).end();
    });
    return true;
  }

  if (method === "DELETE") {
    const proof = proofOf();
    openerState.calls.push({ method, locator, proof, bearer: bearerOf() });
    if (proof === null) refuse();
    else if (!openerState.slots.delete(locator)) notFound();
    else res.writeHead(204).end();
    return true;
  }
  return false;
}
