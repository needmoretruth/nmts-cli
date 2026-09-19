// The Platform's business doors, answered for a test.
//
// ⛔ ITS OWN FILE FOR THE REASON `fake-erase.ts` HAS ONE: `check:size` measures `fake-drive.ts`.
//
// ⛔ IT VERIFIES THE SIGNATURE, AND IT REBUILDS THE SIGNED SENTENCE FROM THE WIRE. The bearer, the
//    method, the path and the raw body that arrived are what go into the message here — nothing is
//    taken from the caller's own idea of what it signed. So a client that signed the wrong path,
//    the wrong method or a different body is refused by this fake exactly as the server refuses it,
//    which is the only part of the exchange a test on this side can actually judge.
//
// ⚠ WHAT IT IS NOT. It is not the verifier: whether `verify_strict` accepts a given encoding, what
//   a replayed signature costs, and every ceiling are the server's, and are judged where the server
//   is. This answers shapes.

import type { IncomingMessage, ServerResponse } from "node:http";

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { fromBase64Url, utf8 } from "../src/bytes.ts";

export interface PlatformState {
  /** The business this fake knows: its account id and the public key it registered. */
  business: { accountId: string; publicKey: string; name: string | null };
  usersToday: number;
  usersDayCap: number;
  /** Every accepted call, in order: `POST /p1/users` and what it carried. */
  registered: { accountId: string; authSecret: string; bearer: string }[];
  /** Every key this business has rotated onto, in order. */
  rotations: string[];
}

export const platformState: PlatformState = {
  business: { accountId: "", publicKey: "", name: null },
  usersToday: 0,
  usersDayCap: 1000,
  registered: [],
  rotations: [],
};

export function resetPlatform(): void {
  platformState.business = { accountId: "", publicKey: "", name: null };
  platformState.usersToday = 0;
  platformState.usersDayCap = 1000;
  platformState.registered = [];
  platformState.rotations = [];
}

/** Answer the request if it is one of the Platform doors; say whether it was. */
export function servePlatform(method: string, url: string, req: IncomingMessage, res: ServerResponse): boolean {
  if (!url.startsWith("/p1/")) return false;
  let raw = "";
  req.on("data", (c: Buffer) => (raw += c.toString("utf8")));
  req.on("end", () => answer(method, url, req, res, raw));
  return true;
}

function answer(method: string, url: string, req: IncomingMessage, res: ServerResponse, raw: string): void {
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const refuse = (code: string, status: number, message: string): void =>
    json(status, { error: { code, message } });

  const bearer = bearerOf(req);
  if (method === "POST" && url === "/p1/users" && bearer.startsWith("nmts_dt1_")) {
    // A delegation token is the other way in. Its own signature is the server's to judge; what
    // this fake holds is that the body is the pair an account is made from.
    return withCredentials(raw, json, refuse, bearer);
  }
  if (!businessSignatureHolds(bearer, method, url, raw)) {
    return refuse("BUSINESS_SIGNATURE_INVALID", 401, "the business signature was refused");
  }
  if (method === "GET" && url === "/p1/business") {
    return json(200, {
      business: {
        account_id: platformState.business.accountId,
        pubkey: platformState.business.publicKey,
        name: platformState.business.name,
        created_at: "2026-09-17T00:00:00Z",
        users_today: platformState.usersToday,
        users_day_cap: platformState.usersDayCap,
      },
    });
  }
  if (method === "PUT" && url === "/p1/business/key") {
    const body: unknown = raw === "" ? {} : JSON.parse(raw);
    const next = at(body, "pubkey");
    const proof = at(body, "proof");
    if (typeof next !== "string" || typeof proof !== "string") {
      return refuse("VALIDATION", 400, "the request body is not valid JSON");
    }
    // ⛔ THE NEW KEY PROVES ITSELF OVER THE OLD ONE, which is what makes a rotation need both.
    const message = new Uint8Array([...utf8("nmts/p1/rotate/v1\n"), ...fromBase64Url(platformState.business.publicKey)]);
    if (!holds(next, message, proof)) {
      return refuse("BUSINESS_SIGNATURE_INVALID", 401, "the business signature was refused");
    }
    platformState.business.publicKey = next;
    platformState.rotations.push(next);
    res.writeHead(204);
    res.end();
    return;
  }
  if (method === "POST" && url === "/p1/users") {
    return withCredentials(raw, json, refuse, bearer);
  }
  refuse("NOT_FOUND", 404, "no such route");
}

/** `POST /p1/users`, whichever credential opened it. */
function withCredentials(
  raw: string,
  json: (status: number, body: unknown) => void,
  refuse: (code: string, status: number, message: string) => void,
  bearer: string,
): void {
  const body: unknown = raw === "" ? {} : JSON.parse(raw);
  const accountId = at(body, "account_id");
  const authSecret = at(body, "auth_secret");
  if (typeof accountId !== "string" || typeof authSecret !== "string") {
    return refuse("VALIDATION", 400, "the request body is not valid JSON");
  }
  if (platformState.usersToday >= platformState.usersDayCap) {
    return refuse("PLATFORM_USER_CAP", 429, "this business has already registered as many users today as it may");
  }
  platformState.usersToday += 1;
  platformState.registered.push({ accountId, authSecret, bearer });
  json(201, {
    account: { account_id: accountId, kdf_version: 1, status: "active", created_at: "2026-09-17T00:00:00Z" },
  });
}

function bearerOf(req: IncomingMessage): string {
  const header = req.headers["authorization"];
  return typeof header === "string" && header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

/** Rebuild the signed sentence from what arrived, and check it against the registered key. */
function businessSignatureHolds(bearer: string, method: string, path: string, raw: string): boolean {
  if (!bearer.startsWith("nmts_bs1_")) return false;
  const fields = bearer.slice("nmts_bs1_".length).split(".");
  // Four fields, and a nonce of exactly 16 bytes — the shape the server insists on.
  if (fields.length !== 4) return false;
  const [account, ts, nonce, signature] = fields;
  if (account === undefined || ts === undefined || nonce === undefined || signature === undefined) return false;
  if (account !== platformState.business.accountId) return false;
  if (!isNonce(nonce)) return false;
  const message = utf8(
    `nmts/p1/business/v1\n${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bytesToHex(sha256(utf8(raw)))}`,
  );
  return holds(platformState.business.publicKey, message, signature);
}

function isNonce(text: string): boolean {
  try {
    return fromBase64Url(text).length === 16;
  } catch {
    return false;
  }
}

function holds(publicKey: string, message: Uint8Array, signature: string): boolean {
  try {
    return ed25519.verify(fromBase64Url(signature), message, fromBase64Url(publicKey), { zip215: false });
  } catch {
    return false;
  }
}

function at(from: unknown, name: string): unknown {
  return typeof from === "object" && from !== null ? Reflect.get(from, name) : undefined;
}
