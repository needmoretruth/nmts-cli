// The two Platform credentials, made here: a business's signature over one request, and the
// delegation token it mints for one of its users.
//
// ⛔ THE SERVER HOLDS ONLY THE VERIFICATION HALF. A business makes this key pair, keeps the secret
//    half, and registers the public half once. Nothing here is ever sent: what travels is a
//    signature, and a signature cannot be turned back into the key that made it.
//
// ⛔ NO CURVE IS WRITTEN HERE. `@noble/curves` signs and verifies; this module decides only WHAT
//    is signed. Every byte layout below is the one the server verifies, and each is a fixed
//    sentence with its own context string — a signature made for one purpose must not verify as
//    another, which is the whole reason the contexts exist.
//
// ⛔ THE BODY IS INSIDE A BUSINESS SIGNATURE, as a SHA-256 digest in lower-case hex. So a proxy
//    that rewrote one byte of the request invalidates it, and a signature captured off one request
//    cannot be replayed onto a different body, method or path.
//
// ⚠ THE FIELDS ARE NEWLINE-SEPARATED and none of them can contain a newline — the timestamp is
//   digits, the method is letters, a request path carries none, and the digest is hex. Joining
//   them without a separator would let two different requests produce the same bytes.
//
// ⚠ A TOKEN'S PAYLOAD IS SIGNED AS THE BYTES THAT TRAVEL, never as a value re-encoded on the far
//   side: two JSON writers disagree about spacing and key order, and a receiver that re-serialised
//   would verify some correct tokens and refuse others.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

import { concat, fromBase64Url, toBase64Url, utf8 } from "./bytes.ts";
import { NmtsError } from "./errors.ts";

/** The fixed prefix of a business signature. `1` is the format version, so a later shape is `bs2_`. */
export const BUSINESS_PREFIX = "nmts_bs1_";

/** …and of a delegation token. */
export const DELEGATION_PREFIX = "nmts_dt1_";

/** What a business signature covers, before the moment, the nonce, the method, the path and the digest. */
export const BUSINESS_CONTEXT = "nmts/p1/business/v1";

/** What a business signs over a delegation payload. */
export const DELEGATION_CONTEXT = "nmts/p1/delegation/v1";

/** What the NEW key signs over the old one when a business replaces its key. */
export const ROTATE_CONTEXT = "nmts/p1/rotate/v1";

/** Ed25519 key and signature lengths, named because a parser and a refusal both state them. */
export const PUBKEY_LEN = 32;
export const PRIVATE_KEY_LEN = 32;
export const SIGNATURE_LEN = 64;

/**
 * The random half of a delegation payload, and of a business signature: 16 bytes each, so two
 * credentials made in the same second for the same thing are still different strings.
 */
export const NONCE_LEN = 16;

/** The longest life a delegation token may be minted with — thirty days. */
export const DELEGATION_MAX_TTL_SECS = 2_592_000;

/**
 * What a delegation token may open, by name.
 *
 * ⛔ THE FIRST THREE ARE AN API KEY'S OWN SCOPES, value for value. One vocabulary, so that a
 *    business asking for "read and write" asks for the number a person's key already means by it.
 *    `register` is the fourth and opens exactly one door: making the account the token names.
 */
export const SCOPE_BITS = {
  files_read: 1,
  files_write: 2,
  storage_spend: 4,
  register: 8,
} as const satisfies Record<string, number>;

/** One of the four names above. */
export type ScopeName = keyof typeof SCOPE_BITS;

/** Every bit a token may carry. */
export const SCOPE_ALL = SCOPE_BITS.files_read | SCOPE_BITS.files_write | SCOPE_BITS.storage_spend | SCOPE_BITS.register;

/** A business's key pair, both halves base64url. The private half never travels. */
export interface BusinessKeyPair {
  /** 32 bytes, base64url. This is what is registered, and it is not a secret. */
  publicKey: string;
  /** 32 bytes, base64url. ⛔ The only copy: nothing can derive it back from the public half. */
  privateKey: string;
}

/**
 * A new key pair, from the runtime's own random source.
 *
 * ⚠ The randomness is the curve library's, which is the platform's `crypto.getRandomValues`. There
 *   is no second source here: a key drawn from anything weaker is a business somebody else can
 *   speak for.
 */
export function generateBusinessKeys(): BusinessKeyPair {
  const pair = ed25519.keygen();
  return { publicKey: toBase64Url(pair.publicKey), privateKey: toBase64Url(pair.secretKey) };
}

/** The public half of a private key, so a caller never has to keep the two in step by hand. */
export function businessPublicKey(privateKey: string): string {
  return toBase64Url(ed25519.getPublicKey(secretBytes(privateKey)));
}

/**
 * The bytes a business signature covers.
 *
 * `path` is the request path as it is sent, with no query string: no Platform door takes one, and
 * a signature that did not cover a parameter the server then read would be a signature over half
 * the request.
 *
 * ⚠ THE NONCE IS SIGNED AS THE TEXT THAT TRAVELS, base64url, on its own line after the moment —
 *   so the sender and the receiver agree about the field without either re-encoding it.
 */
export function businessSigningInput(
  ts: number,
  nonce: string,
  method: string,
  path: string,
  body: Uint8Array,
): Uint8Array {
  return utf8(`${BUSINESS_CONTEXT}\n${ts}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bytesToHex(sha256(body))}`);
}

/** The bytes a delegation signature covers: the context, then the payload exactly as it travels. */
export function delegationSigningInput(payload: Uint8Array): Uint8Array {
  return concat([utf8(`${DELEGATION_CONTEXT}\n`), payload]);
}

/** The bytes the new key signs during a rotation: the context, then the key being replaced. */
export function rotationSigningInput(oldPublicKey: string): Uint8Array {
  return concat([utf8(`${ROTATE_CONTEXT}\n`), exactly(oldPublicKey, PUBKEY_LEN, "public key")]);
}

/** What one signed request is about. */
export interface BusinessRequest {
  /** The business account's public id, base64url — what the server knows it by. */
  accountId: string;
  privateKey: string;
  method: string;
  /** The path as it will be sent, `/p1/business`. */
  path: string;
  /** The request body exactly as it will be sent. Empty for a GET. */
  body?: Uint8Array | undefined;
  /** Unix seconds. Absent = now. The server accepts a window either side of its own clock. */
  at?: number | undefined;
  /**
   * The 16 random bytes this one request carries, base64url.
   *
   * ⚠ FOR A TEST THAT NEEDS THE SAME CREDENTIAL TWICE, and for nothing else. Left out, it is drawn
   *   from the runtime's random source, which is what makes two identical requests two requests.
   */
  nonce?: string | undefined;
}

/**
 * The whole `Authorization: Bearer` value for one request to a Platform door.
 *
 * ⛔ ONE SIGNATURE, ONE REQUEST. The server remembers each accepted signature for the length of its
 *    clock window and refuses a second presentation of the same one, so a value from here is not a
 *    credential to keep — it is made for the request it is about and spent on it.
 *
 * ⛔ AND THAT IS WHY THE NONCE IS HERE. Ed25519 is deterministic and the moment is whole seconds,
 *    so two identical requests inside one second would otherwise be the same bytes — and the
 *    second of them would be refused as a replay of the first.
 */
export function signBusinessRequest(request: BusinessRequest): string {
  const ts = request.at ?? nowSeconds();
  const nonce = request.nonce ?? toBase64Url(randomBytes(NONCE_LEN));
  // ⚠ Checked here because the server checks it: a credential it cannot describe is one it
  //   refuses, and the refusal would arrive as an authentication failure on a correct request.
  exactly(nonce, NONCE_LEN, "nonce");
  const message = businessSigningInput(ts, nonce, request.method, request.path, request.body ?? new Uint8Array(0));
  const signature = ed25519.sign(message, secretBytes(request.privateKey));
  return `${BUSINESS_PREFIX}${request.accountId}.${ts}.${nonce}.${toBase64Url(signature)}`;
}

/** What one delegation token says. */
export interface DelegationRequest {
  /** The business's own account id, base64url. */
  business: string;
  /** The account id of the user this token speaks for, base64url. */
  user: string;
  privateKey: string;
  /** What the token may do. At least one; an empty set opens nothing. */
  scope: readonly ScopeName[];
  /** How long it lasts, in seconds. At most [`DELEGATION_MAX_TTL_SECS`]. */
  ttlSecs: number;
  /** Unix seconds this life is counted from. Absent = now. */
  at?: number | undefined;
  /**
   * The 16 random bytes in the payload, base64url.
   *
   * ⚠ FOR A TEST THAT NEEDS THE SAME TOKEN TWICE, and for nothing else. Left out, it is drawn from
   *   the runtime's random source, which is what makes two tokens with identical fields differ.
   */
  nonce?: string | undefined;
}

/**
 * Mint one delegation token.
 *
 * ⛔ THE LIFE IS REFUSED HERE AS WELL AS THERE. A token longer than the ceiling is refused by the
 *    server as malformed, which reaches the business as an authentication failure on somebody
 *    else's request; refusing it where it is made names the mistake to the program that made it.
 */
export function mintDelegation(request: DelegationRequest): string {
  const scope = scopeMask(request.scope);
  if (request.ttlSecs <= 0 || !Number.isFinite(request.ttlSecs)) {
    throw new NmtsError("A delegation token's life must be a positive number of seconds.", {
      exitCode: 2,
      nextStep: "Nothing was minted. Ask for the number of seconds the token should last.",
    });
  }
  if (request.ttlSecs > DELEGATION_MAX_TTL_SECS) {
    throw new NmtsError(
      `A delegation token may last at most ${DELEGATION_MAX_TTL_SECS} seconds (30 days); ${request.ttlSecs} was asked for.`,
      {
        exitCode: 2,
        nextStep:
          "Nothing was minted. Mint a shorter one and mint it again when it runs out — a token " +
          "cannot be withdrawn, so its life is the only bound on it.",
      },
    );
  }
  const exp = (request.at ?? nowSeconds()) + Math.floor(request.ttlSecs);
  const nonce = request.nonce ?? toBase64Url(randomBytes(NONCE_LEN));
  // ⚠ The nonce's shape is checked here because the server checks it: a payload it cannot describe
  //   is one it refuses, and the refusal would arrive on a user's request rather than on this call.
  exactly(nonce, NONCE_LEN, "nonce");
  const payload = utf8(
    JSON.stringify({ v: 1, b: request.business, u: request.user, exp, s: scope, n: nonce }),
  );
  const signature = ed25519.sign(delegationSigningInput(payload), secretBytes(request.privateKey));
  return `${DELEGATION_PREFIX}${toBase64Url(payload)}.${toBase64Url(signature)}`;
}

/**
 * The proof the new key makes of itself when a business replaces its key.
 *
 * ⛔ THE OLD KEY IS IN THE MESSAGE, so this proof is about THIS replacement and cannot be lifted
 *    onto another. The request carrying it is signed by the old key, so a rotation needs both
 *    halves in one hand.
 */
export function rotationProof(oldPublicKey: string, newPrivateKey: string): string {
  return toBase64Url(ed25519.sign(rotationSigningInput(oldPublicKey), secretBytes(newPrivateKey)));
}

/** The bitmask these scope names make. */
export function scopeMask(scopes: readonly ScopeName[]): number {
  let mask = 0;
  for (const name of scopes) mask |= SCOPE_BITS[name];
  if (mask === 0) {
    throw new NmtsError("A delegation token with no scope can open nothing.", {
      exitCode: 2,
      nextStep: `Nothing was minted. Name at least one of: ${Object.keys(SCOPE_BITS).join(", ")}.`,
    });
  }
  return mask;
}

/** Does this signature hold over these bytes? Here so a caller can check its own work offline. */
export function signatureHolds(publicKey: string, message: Uint8Array, signature: string): boolean {
  try {
    return ed25519.verify(exactly(signature, SIGNATURE_LEN, "signature"), message, exactly(publicKey, PUBKEY_LEN, "public key"), {
      zip215: false,
    });
  } catch {
    // A key or a signature that is not well formed did not verify, which is the answer asked for.
    return false;
  }
}

/** Unix seconds. One reading, so a signature and the value inside it cannot come from two clocks. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** The private key as bytes, refusing anything that is not one — before it is handed to the curve. */
function secretBytes(privateKey: string): Uint8Array {
  return exactly(privateKey, PRIVATE_KEY_LEN, "private key");
}

/**
 * Base64url of exactly this many bytes, or a refusal that names the field and never the value.
 *
 * ⛔ THE VALUE IS NOT IN THE MESSAGE. One of the things that comes through here is a private key,
 *    and a refusal a caller logs is not a place for it.
 */
function exactly(text: string, length: number, what: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(text);
  } catch {
    throw new NmtsError(`That ${what} is not base64url.`, {
      exitCode: 2,
      nextStep: `Nothing was signed. A ${what} is ${length} bytes written as base64url.`,
    });
  }
  if (bytes.length !== length) {
    throw new NmtsError(`That ${what} is ${bytes.length} bytes; it must be ${length}.`, {
      exitCode: 2,
      nextStep: `Nothing was signed. Check that the right value was passed as the ${what}.`,
    });
  }
  return bytes;
}
