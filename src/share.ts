// Sharing one file with one other account: what gets sealed, in what order, and why that order.
//
// ⛔ NOTHING HERE TRUSTS THE SERVER WITH A KEY. A share hands a recipient the file's own key,
//    wrapped so that only they can open it. The server stores an opaque envelope and three sealed
//    fields; it can open none of them, and it cannot tell whether a share it stored is one that
//    was actually made.
//
// ⛔ THE ORDER IS LOAD-BEARING. The name and the digest are sealed FIRST, and the exact bytes that
//    result are hashed into the key that wraps the file key. So a name sealed afterwards, or one
//    byte different from what is actually sent, produces an envelope the recipient cannot open.
//    That is what stops a server rewriting the name a file arrived under: it would have to produce
//    a wrapping key it does not have.
//
// ⛔ OPENING IT IS THE AUTHENTICATION. There is no separate signature to check. The sender's own
//    secret is inside the key agreement, so an envelope that opens at all could only have been
//    made by the account it names. The claimed sender is therefore printed only AFTER the open
//    succeeds — before that it is a claim, and printing a claim as a fact is how somebody trusts
//    a file that was not sent by who it says.

import { fromBase64Url, toBase64Url } from "./bytes.ts";
import { AAD, DERIVED, type CryptoGlue } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import {
  decodeSharedFileInfo,
  encodeSharedFileInfo,
} from "./shared/lib/share/shared-file-info.ts";

const encoder = new TextEncoder();

/** Exact sizes the server checks. Named here so a wrong one is caught before a round trip. */
const ENVELOPE_LEN = 1240;
const DIGEST_ENVELOPE_LEN = 104;
const IDENTITY_LEN = 4989;

/**
 * This account's sharing secrets, and the identity other people encrypt to.
 *
 * ⛔ THE CALLER WIPES IT. Three of these are secrets sliced out of the account's derivation, and
 *    they open every share this account has ever received. `wipe()` on every path out, including
 *    failures.
 */
export interface ShareKeys {
  /**
   * Which of this key's numbered public codes these are (NCF-3 §5.9). 0 is the code every account
   * has had from the start; `share-codes.ts` derives the others.
   */
  index: number;
  /** Key-agreement seed. */
  kemSeed: Uint8Array;
  /** Proves this account SENT a share. */
  authSecret: Uint8Array;
  /** Signs the published identity. */
  sigSeed: Uint8Array;
  /** This account's 16-byte public code, in its wire form. */
  address: Uint8Array;
  /** The published identity bundle other people encrypt to. */
  identity: Uint8Array;
  /** The address in the form a person reads and types. */
  display: string;
  wipe(): void;
}

/** Derive everything sharing needs from an NMTS key. */
export function shareKeysOf(crypt: CryptoGlue, code: string): ShareKeys {
  const derived = crypt.kdf_derive(crypt.account_code_parse(code));
  try {
    return shareKeysFromDerived(crypt, derived);
  } finally {
    derived.fill(0);
  }
}

/** Code 0's keys out of one run of the key's derivation. The caller wipes `derived`. */
export function shareKeysFromDerived(crypt: CryptoGlue, derived: Uint8Array): ShareKeys {
  const slice = (range: readonly [number, number]): Uint8Array =>
    derived.slice(range[0], range[1]);
  const kemSeed = slice(DERIVED.shareKemSeed);
  const authSecret = slice(DERIVED.shareAuthSecret);
  const sigSeed = slice(DERIVED.shareSigSeed);
  const address = slice(DERIVED.shareAddress);
  const identity = crypt.share_public_key(kemSeed, authSecret, sigSeed);
  if (identity.length !== IDENTITY_LEN) {
    throw new NmtsError(`This account's sharing identity came out ${identity.length} bytes.`, {
      nextStep: "Nothing was sent. The crypto engine and this tool disagree about the format.",
    });
  }
  return {
    index: 0,
    kemSeed,
    authSecret,
    sigSeed,
    address,
    identity,
    display: crypt.share_address_display(address),
    wipe() {
      kemSeed.fill(0);
      authSecret.fill(0);
      sigSeed.fill(0);
    },
  };
}

/** The three sealed fields a share carries, base64url, exactly as they go to the server. */
export interface SharePayload {
  dek_share_ct: string;
  name_share_ct: string;
  content_hash_share_ct: string;
}

/**
 * Seal one file for one recipient.
 *
 * `recipientIdentity` is checked against `recipientAddress` inside the engine before anything is
 * encrypted to it — length, fingerprint, self-signature and key decoding — which is why both are
 * arguments and why there is no form of this that takes the identity alone. A tool that fetched an
 * identity and wrapped to it without naming the address it asked for would hand a readable key to
 * whoever answered.
 */
export function sealShare(
  crypt: CryptoGlue,
  input: {
    keys: ShareKeys;
    recipientIdentity: Uint8Array;
    recipientAddress: Uint8Array;
    /** The file's own key, already unwrapped from the account's sealed list. */
    dek: Uint8Array;
    /** The file's id, exactly as it will be posted. */
    itemId: string;
    /** The name the recipient sees, and the file's real plaintext length. */
    name: string;
    size: number;
    /** The file's whole-plaintext digest, opened from the account's own sealed copy. */
    digest: Uint8Array;
    /**
     * The name document to seal in place of the share's own — a handover's, which also binds its
     * parts list and network (NCF-3 §5.6). A built-in share never passes one.
     */
    nameDocument?: string;
  },
): SharePayload {
  if (input.digest.length !== 32) {
    throw new NmtsError("This file has no recorded content hash, so it cannot be shared.", {
      nextStep:
        "A share carries a hash the recipient checks the bytes against. Without one there is " +
        "nothing to check, and a share that proves nothing is not one this tool will make.",
    });
  }
  // ⛔ SEALED FIRST, AND THESE EXACT BYTES ARE WHAT GETS SENT. See the module note.
  const nameCt = crypt.envelope_seal(
    input.dek,
    encoder.encode(AAD.shareName),
    encoder.encode(input.nameDocument ?? encodeSharedFileInfo({ name: input.name, size: input.size })),
  );
  const digestCt = crypt.envelope_seal(input.dek, encoder.encode(AAD.shareContentHash), input.digest);
  if (digestCt.length !== DIGEST_ENVELOPE_LEN) {
    throw new NmtsError(`A sealed content hash came out ${digestCt.length} bytes.`);
  }
  // ⚠ THE SENDER'S NUMBER IS INSIDE THE ENVELOPE: it names which of this key's codes sent it, so a
  //   code other than 0 wraps through the engine's numbered form.
  const k = input.keys;
  const envelope =
    k.index === 0
      ? crypt.share_wrap_dek(k.authSecret, k.sigSeed, input.recipientIdentity, input.recipientAddress, input.dek, input.itemId, nameCt, digestCt)
      : crypt.share_wrap_dek_as(k.authSecret, k.sigSeed, k.index, input.recipientIdentity, input.recipientAddress, input.dek, input.itemId, nameCt, digestCt);
  if (envelope.length !== ENVELOPE_LEN) {
    throw new NmtsError(`A share envelope came out ${envelope.length} bytes.`);
  }
  return {
    dek_share_ct: toBase64Url(envelope),
    name_share_ct: toBase64Url(nameCt),
    content_hash_share_ct: toBase64Url(digestCt),
  };
}

/** One row of what somebody shared with this account, as the server describes it. */
export interface ReceivedRow {
  id: string;
  item_id: string;
  /** Bytes on the storage network — NOT the file's length. The sealed document has that. */
  size: number;
  sender_public_key?: string;
  /** Which of this account's public codes it was sent to. Absent from an older server: code 0. */
  to_index?: number;
  /** Whether the sender has revoked the code it was sent from. */
  sender_code_revoked?: boolean;
  dek_share_ct: string;
  name_share_ct: string;
  content_hash_share_ct: string;
  created_at: string;
}

/**
 * Which of this account's codes a received row came to. A number the server should never send —
 * negative, fractional, past a code's range — reads as 0, where the open then fails and says so.
 */
export function receivedIndex(row: ReceivedRow): number {
  const n = row.to_index;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 2 ** 31 - 2 ? n : 0;
}

/** What a received share turns into once opened, or why it could not be. */
export interface OpenedShare {
  id: string;
  itemId: string;
  createdAt: string;
  /** The file's name as the sender sealed it, or null when the row would not open. */
  name: string | null;
  /** The file's real plaintext length, when the sender recorded one. */
  size: number | null;
  /** The sender's address, in readable form — only ever set when the open SUCCEEDED. */
  sender: string | null;
  /** Which of this account's public codes it came to, and whether the sender revoked theirs. */
  toIndex: number;
  senderRevoked: boolean;
  /** The file's own key. Present only when it opened; the caller wipes it. */
  dek: Uint8Array | null;
  /** The sealed digest, carried through so a download can check the bytes. */
  digestCt: string;
  /** Why it did not open, for a row that must still be listed. */
  problem: string | null;
}

/**
 * Open one received share.
 *
 * ⛔ A ROW THAT WILL NOT OPEN IS STILL RETURNED. Dropping it would tell the account it was sent
 *    less than it was, and the honest answer to "this one will not open" is to say so on its own
 *    line — not to leave a gap somebody has no way to notice.
 */
export function openReceived(
  crypt: CryptoGlue,
  keys: ShareKeys,
  row: ReceivedRow,
): OpenedShare {
  const base = {
    id: row.id,
    itemId: row.item_id,
    createdAt: row.created_at,
    digestCt: row.content_hash_share_ct,
    toIndex: receivedIndex(row),
    senderRevoked: row.sender_code_revoked === true,
  };
  const unopened = (problem: string): OpenedShare => ({
    ...base,
    name: null,
    size: null,
    sender: null,
    dek: null,
    problem,
  });
  if (row.sender_public_key === undefined || row.sender_public_key === "") {
    // The sender's identity is what the open is checked against. Without it there is nothing to
    // authenticate against, and an unauthenticated open is not one worth doing.
    return unopened("the sender's published identity is not available");
  }
  // ⚠ Decoded inside the try: a row whose fields are not base64 is a row that will not open, and it
  //   is still listed.
  let envelope: Uint8Array = new Uint8Array(0);
  let nameCt: Uint8Array = new Uint8Array(0);
  let dek: Uint8Array;
  try {
    envelope = fromBase64Url(row.dek_share_ct);
    nameCt = fromBase64Url(row.name_share_ct);
    const digestCt = fromBase64Url(row.content_hash_share_ct);
    const senderPublic = fromBase64Url(row.sender_public_key);
    dek = unwrapWith(crypt, keys, { senderPublic, envelope, itemId: row.item_id, nameCt, digestCt });
  } catch {
    return unopened("it did not open with this account's keys");
  }
  // ⛔ ONLY NOW. Before the unwrap succeeded this was a claim printed next to a file name, which is
  //    exactly how somebody comes to trust a file that was not sent by who it says.
  let sender: string;
  try {
    sender = crypt.share_address_display(crypt.share_claimed_sender(envelope));
  } catch {
    dek.fill(0);
    return unopened("the sender it names is not a readable address");
  }
  let info: { name: string; size?: number };
  try {
    info = decodeSharedFileInfo(
      new TextDecoder().decode(crypt.envelope_open(dek, encoder.encode(AAD.shareName), nameCt)),
    );
  } catch {
    dek.fill(0);
    return unopened("the file's name did not open");
  }
  return {
    ...base,
    name: info.name,
    size: info.size ?? null,
    sender,
    dek,
    problem: null,
  };
}

/** The sealed parts of one share that its recipient opens with. */
export interface ShareSealed {
  senderPublic: Uint8Array;
  envelope: Uint8Array;
  itemId: string;
  nameCt: Uint8Array;
  digestCt: Uint8Array;
}

/**
 * Open one envelope with one of this account's codes. Throws when it will not open.
 *
 * ⚠ THE RECIPIENT'S NUMBER IS PART OF WHAT OPENS IT, so the keys must be the code it was sent to:
 *   code 0 through the engine's first form, any other through its numbered one.
 */
export function unwrapWith(crypt: CryptoGlue, keys: ShareKeys, s: ShareSealed): Uint8Array {
  return keys.index === 0
    ? crypt.share_unwrap_dek(keys.kemSeed, keys.authSecret, keys.sigSeed, s.senderPublic, s.envelope, s.itemId, s.nameCt, s.digestCt)
    : crypt.share_unwrap_dek_as(keys.kemSeed, keys.authSecret, keys.sigSeed, keys.index, s.senderPublic, s.envelope, s.itemId, s.nameCt, s.digestCt);
}

/** The digest a recipient checks the downloaded bytes against. */
export function openSharedDigest(
  crypt: CryptoGlue,
  dek: Uint8Array,
  digestCt: string,
): Uint8Array | null {
  try {
    return crypt.envelope_open(
      dek,
      encoder.encode(AAD.shareContentHash),
      fromBase64Url(digestCt),
    );
  } catch {
    return null;
  }
}

/**
 * Turn what a person typed into the 16 bytes behind a public code.
 *
 * ⛔ A TYPO FAILS HERE, NOT AS A LOOKUP. Sending a mistyped address to the server would ask it a
 *    question about somebody who might exist, and the answer is not ours to collect.
 */
export function addressFromTyped(crypt: CryptoGlue, typed: string): Uint8Array {
  try {
    return crypt.share_address_parse(typed.trim());
  } catch {
    throw new NmtsError(`"${typed.trim()}" is not a public code.`, {
      exitCode: 2,
      nextStep:
        "Nothing was sent. An address has a check symbol built in, so this was caught here " +
        "rather than by asking the server about it.",
    });
  }
}

/**
 * Check that an identity the server handed back is the one that was asked for.
 *
 * The engine checks this again inside the wrap, and this exists so the refusal says WHICH thing
 * was wrong rather than failing inside a sealing step.
 */
export function identityMatches(
  crypt: CryptoGlue,
  identity: Uint8Array,
  address: Uint8Array,
): boolean {
  if (identity.length !== IDENTITY_LEN) return false;
  try {
    const fingerprint = crypt.share_address_of(identity);
    return fingerprint.length === address.length && fingerprint.every((byte, at) => byte === address[at]);
  } catch {
    return false;
  }
}
