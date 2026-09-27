// An account's public codes on the server: reading them, publishing the next one, revoking one.
//
// ⛔ NO TERMINAL HERE. `nmts public-code …`, `nmts share` and the library's `publicCodes` all come
//    through these functions, so the three answer the same account the same way; what a person is
//    told about a refusal is the command's business (`commands/public-code-manage.ts`), and a
//    program gets the server's own `ServerError` with its code to branch on.
//
// ⛔ THE NEXT NUMBER IS THE HIGHEST EVER PLUS ONE, revoked ones included, and nothing is guessed
//    beyond that: the server answers which number it wanted when it refuses one (`INDEX_NOT_NEXT`),
//    and a number whose code was revoked once — by this account before it was erased and made again
//    from the same key — is refused for ever, so publishing walks past it.
//
// ⚠ THE DEFAULT CODE IS NOT STORED ANYWHERE. It is the lowest-numbered live one, read
//   off the list every time.

import { request, ServerError } from "./api.ts";
import { fromBase64Url, toBase64Url } from "./bytes.ts";
import type { CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { isRecord } from "./guards.ts";
import { requireCodeIndex, shareKeyRing } from "./share-codes.ts";

/** One code as `GET /v1/account/public-codes` lists it. */
export interface PublicCodeRow {
  index: number;
  /** The 16-byte address, base64url, as the wire carries it. */
  address: string;
  createdAt: string;
  /** When it was revoked, or null while it is live. */
  revokedAt: string | null;
  /** Shares sent from it, shares received with it, support threads that carry it. */
  sent: number;
  received: number;
  support: number;
}

/** The whole answer: every code this account ever published, and the two ceilings on making more. */
export interface PublicCodeList {
  codes: PublicCodeRow[];
  /** How many may be live at once — 3, or 1 for a Platform user. */
  liveMax: number;
  /** How many new ones this account may make per UTC day, and how many it has made today. */
  dayCap: number;
  madeToday: number;
}

/** How many numbers in a row publishing walks past before it stops. */
export const PUBLISH_TRIES = 64;

const unreadable = (): NmtsError =>
  new NmtsError("The server listed this account's public codes in a shape this version cannot read.", {
    nextStep: "Nothing was changed. A newer version of this tool may understand it.",
  });

function whole(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw unreadable();
  return value;
}

function readRow(value: unknown): PublicCodeRow {
  if (!isRecord(value) || typeof value["address"] !== "string" || typeof value["created_at"] !== "string") {
    throw unreadable();
  }
  const revoked = value["revoked_at"];
  return {
    index: whole(value["index"]),
    address: value["address"],
    createdAt: value["created_at"],
    revokedAt: typeof revoked === "string" ? revoked : null,
    sent: whole(value["sent"] ?? 0),
    received: whole(value["received"] ?? 0),
    support: whole(value["support"] ?? 0),
  };
}

/** `GET /v1/account/public-codes`, read field by field. Codes come back in number order. */
export async function readPublicCodes(server: string, token: string): Promise<PublicCodeList> {
  const answer: unknown = await request(server, "/v1/account/public-codes", { token });
  if (!isRecord(answer) || !Array.isArray(answer["codes"])) throw unreadable();
  const codes = answer["codes"].map(readRow).sort((a, b) => a.index - b.index);
  return {
    codes,
    liveMax: whole(answer["live_max"]),
    dayCap: whole(answer["day_cap"]),
    madeToday: whole(answer["made_today"] ?? 0),
  };
}

/** The server wants `index` next and refuses it as revoked, so no number can be published. */
function noNextNumber(index: number): NmtsError {
  return new NmtsError(`The server wants public code #${index} next, and refuses it as revoked.`, {
    exitCode: 4,
    nextStep: "Nothing was published. The server has to let this account skip that number; report it.",
  });
}

/** The live codes, lowest number first. */
export function liveCodes(list: PublicCodeList): PublicCodeRow[] {
  return list.codes.filter((c) => c.revokedAt === null);
}

/** The code this account shows and sends from unless told otherwise: its lowest-numbered live one. */
export function defaultCode(list: PublicCodeList): PublicCodeRow | null {
  return liveCodes(list)[0] ?? null;
}

/** The number a new code gets: one past the highest ever published, or 0 for an account with none. */
export function nextCodeIndex(list: PublicCodeList): number {
  return list.codes.reduce((top, c) => Math.max(top, c.index + 1), 0);
}

/** Where a request goes and what it carries. */
export interface CodeDoor {
  server: string;
  token: string;
}

/** What publishing answers: the number it landed on and the code a person reads. */
export interface PublishedCode {
  index: number;
  /** The grouped form a person reads and types. */
  code: string;
  /** The 16 bytes, base64url. */
  address: string;
}

/**
 * Publish this key's code at `from` (default: the next number), revoking `replace` in the same
 * request when it is given. Walks past numbers the server says were revoked, up to `PUBLISH_TRIES`.
 *
 * ⛔ THE IDENTITY IS DERIVED HERE AND NOWHERE ELSE. There is no form of this that takes an identity
 *    from a caller: what goes to the server is what this key makes at that number.
 */
export async function publishCode(
  crypt: CryptoGlue,
  code: string,
  door: CodeDoor,
  from: number,
  replace?: number,
): Promise<PublishedCode> {
  let index = requireCodeIndex(from);
  // ⛔ ONE RING for the walk: the key's derivation runs once, not once per number tried.
  const ring = shareKeyRing(crypt, code);
  const refusedAsRevoked = new Set<number>();
  try {
    for (let tries = 0; tries < PUBLISH_TRIES; tries += 1) {
      const keys = ring.at(index);
      try {
        const address = toBase64Url(keys.address);
        await request(door.server, "/v1/account/public-codes", {
          token: door.token,
          method: "POST",
          body: {
            index,
            identity: toBase64Url(keys.identity),
            address,
            ...(replace === undefined ? {} : { revoke: [requireCodeIndex(replace)] }),
          },
        });
        return { index, code: keys.display, address };
      } catch (error) {
        if (!(error instanceof ServerError)) throw error;
        if (error.code === "PUBLIC_CODE_REVOKED") {
          refusedAsRevoked.add(index);
          index = requireCodeIndex(index + 1);
          continue;
        }
        // Another device made one in between: the server says which number it wants now.
        const wanted = error.details["next"];
        if (error.code === "INDEX_NOT_NEXT" && typeof wanted === "number" && wanted !== index) {
          // ⚠ A server that wants a number it also refuses as revoked would send this back and forth.
          if (refusedAsRevoked.has(wanted)) throw noNextNumber(wanted);
          index = requireCodeIndex(wanted);
          continue;
        }
        throw error;
      }
    }
  } finally {
    ring.wipe();
  }
  throw new NmtsError(`${PUBLISH_TRIES} public code numbers in a row were refused as revoked.`, {
    nextStep: "Nothing was published. Try again later; if it repeats, report it.",
  });
}

/**
 * Make sure the account has a live code, publishing the next number when it has none — what a
 * first share does before anything else. Answers the list as it now stands, and whether it wrote.
 */
export async function ensureLiveCode(
  crypt: CryptoGlue,
  code: string,
  door: CodeDoor,
  onPublish?: () => void,
): Promise<{ list: PublicCodeList; published: PublishedCode | null }> {
  const list = await readPublicCodes(door.server, door.token);
  if (defaultCode(list) !== null) return { list, published: null };
  onPublish?.();
  const published = await publishCode(crypt, code, door, nextCodeIndex(list));
  return { list: await readPublicCodes(door.server, door.token), published };
}

/** One bucket of the server's revoked list, fetched once per lookup that shares it. */
export type RevokedBuckets = Map<string, Promise<Uint8Array[]>>;

/**
 * Whether the code at `address` is on the server's revoked list — or null when the list could not
 * be read (offline, rate-limited, an older server), which is "unknown", not "live".
 *
 * ⛔ ASKED BY BUCKET, NEVER BY CODE. The server keeps SHA-256 of each revoked address; this fetches
 *    every mark whose hex starts with the same digit as this address's mark (one of sixteen) and
 *    compares here. A question about one code would tell the server who is dealing with whom — the
 *    thing a handover exists not to tell it. Needs no credential.
 */
export async function revokedOnServer(
  server: string,
  address: Uint8Array,
  buckets: RevokedBuckets = new Map(),
): Promise<boolean | null> {
  try {
    const mark = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(address)));
    const prefix = (mark[0] ?? 0).toString(16).padStart(2, "0").charAt(0);
    let bucket = buckets.get(prefix);
    if (bucket === undefined) {
      bucket = request(server, `/v1/public-codes/revoked?prefix=${prefix}`, {}).then((answer: unknown) => {
        const marks = isRecord(answer) ? answer["fingerprints"] : null;
        if (!Array.isArray(marks)) throw unreadable();
        return marks.filter((m): m is string => typeof m === "string").map(fromBase64Url);
      });
      buckets.set(prefix, bucket);
    }
    const held = await bucket;
    return held.some((m) => m.length === mark.length && m.every((byte, at) => byte === mark[at]));
  } catch {
    return null;
  }
}

/** `POST /v1/account/public-codes/{index}/revoke`. One way: nothing brings a code back. */
export async function revokeCode(door: CodeDoor, index: number): Promise<void> {
  await request(door.server, `/v1/account/public-codes/${requireCodeIndex(index)}/revoke`, {
    token: door.token,
    method: "POST",
  });
}
