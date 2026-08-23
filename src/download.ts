// Getting one file's bytes back: ask the server where the parts are, read them, open them, check them.
//
// ⛔ THE SERVER NEVER SEES THE FILE, AND NOTHING HERE TRUSTS IT WITH ONE. It says which stored
//    objects a file is made of and how big the file is; every byte that becomes the file is
//    decrypted here under a key derived from the account code, and the whole thing is checked
//    against a hash the account sealed for itself. A server that lies about the parts, or an
//    aggregator that returns the wrong bytes, produces a refusal — never a quietly wrong file.
//
// ⛔ ONLY THE LAST PART MAY BE PADDED. That is the write side's promise (a part carries the bytes
//    it declares, and only the last is rounded up to hide the true size), and it is what makes the
//    answer unique: with padding allowed anywhere, several splits would fit the same numbers and a
//    reader would be guessing which one produced the file. It is checked here rather than assumed.
import { createHash } from "node:crypto";

import { request } from "./api.ts";
import { AAD, DERIVED, loadCrypto } from "./crypto.ts";
import { NmtsError } from "./errors.ts";
import { readBlob, readQuiltPatch, type ReadOptions } from "./walrus.ts";
import { NETWORK_WHEN_UNRECORDED, networkName } from "./shared/lib/storage-network.ts";

/** `storage_kind` in the server's part rows. */
const DEDICATED_BLOB = 0;
const QUILT_PATCH = 1;

interface PartView {
  part_index: number;
  storage_kind: number;
  network?: number;
  blob_id: string;
  patch_id?: string;
}

interface PartsResponse {
  size: number;
  parts: PartView[];
}

function asParts(value: unknown): PartsResponse {
  if (typeof value !== "object" || value === null) throw new NmtsError("The server's answer was not an object.");
  const v = value as Record<string, unknown>;
  const size = v["size"];
  const parts = v["parts"];
  if (typeof size !== "number" || !Array.isArray(parts)) {
    throw new NmtsError("The server described this file in a shape this version cannot read.", {
      nextStep: "Update this tool, or open the file in a browser.",
    });
  }
  const out: PartView[] = [];
  for (const raw of parts) {
    if (typeof raw !== "object" || raw === null) throw new NmtsError("A part was not an object.");
    const p = raw as Record<string, unknown>;
    if (typeof p["part_index"] !== "number" || typeof p["storage_kind"] !== "number" || typeof p["blob_id"] !== "string") {
      throw new NmtsError("A part is missing the fields needed to read it.");
    }
    const view: PartView = {
      part_index: p["part_index"],
      storage_kind: p["storage_kind"],
      blob_id: p["blob_id"],
    };
    if (typeof p["network"] === "number") view.network = p["network"];
    if (typeof p["patch_id"] === "string") view.patch_id = p["patch_id"];
    out.push(view);
  }
  return { size, parts: out };
}

export interface FetchedFile {
  bytes: Uint8Array;
  /** How many stored objects it came from. */
  partCount: number;
  /** Whether the file's own sealed hash was there to check against, and matched. */
  contentHashChecked: boolean;
}

export interface FetchInput {
  base: string;
  apiKey: string;
  accountCode: string;
  itemId: string;
  /** The file's real length, from the account's sealed file list. */
  size: number;
  /** Wrapped file key from the sealed file list. Without it nothing can be opened. */
  dekWrapped: string;
  /** Sealed whole-file hash from the sealed file list, when the account recorded one. */
  contentHashCt?: string | undefined;
  /**
   * Which CHAIN this account's storage lives on — `mainnet` or `testnet`.
   *
   * ⛔ NOT the same question as a part's `network` field. That one says which STORAGE NETWORK holds
   *    the bytes (Walrus, and so far only Walrus); this one picks which of that network's
   *    aggregators to ask, because a blob id is meaningful on exactly one chain.
   */
  chain: string;
  read?: ReadOptions;
}

/**
 * Fetch, decrypt and verify one file.
 *
 * The account code is used and not kept: the data key is derived, unwrapped keys are zeroed, and
 * the derivation output — which holds every other key in the account — never outlives this call.
 */
export async function fetchFile(input: FetchInput): Promise<FetchedFile> {
  const described = asParts(await request(input.base, `/v1/items/${encodeURIComponent(input.itemId)}/parts?for=download`, { token: input.apiKey }));
  if (described.parts.length === 0) {
    throw new NmtsError("The server says this file has no stored parts.", {
      nextStep: "Nothing was written. The file list names it, so open the account in a browser and compare.",
    });
  }
  // ⛔ The server's `size` is a hint; the account's own sealed list is the authority. They should
  //    agree, and when they do not the sealed one wins and the difference is reported.
  const ordered = [...described.parts].sort((a, b) => a.part_index - b.part_index);

  const crypt = await loadCrypto();
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(input.accountCode));
  const dataKey = derived.slice(from, to);
  derived.fill(0);

  let dek: Uint8Array;
  try {
    dek = crypt.envelope_open(dataKey, new TextEncoder().encode(AAD.dekWrap), Buffer.from(input.dekWrapped, "base64url"));
  } catch {
    dataKey.fill(0);
    throw new NmtsError("This file's key did not open with this account's key.", {
      nextStep: "Either the account code belongs to somebody else, or the file list has been altered.",
    });
  }

  let expected: Uint8Array | null = null;
  if (input.contentHashCt !== undefined && input.contentHashCt !== "") {
    try {
      expected = crypt.envelope_open(dataKey, new TextEncoder().encode(AAD.contentHash), Buffer.from(input.contentHashCt, "base64url"));
    } catch {
      dataKey.fill(0);
      dek.fill(0);
      throw new NmtsError("This file's recorded hash did not open with this account's key.");
    }
  }
  dataKey.fill(0);

  const kept: Uint8Array[] = [];
  const hasher = createHash("sha256");
  let remaining = input.size;
  try {
    for (let i = 0; i < ordered.length; i += 1) {
      const part = ordered[i];
      if (part === undefined) continue;
      // ⛔ Refuse before reading, not after. A part on a storage network this build has no reader
      //    for would otherwise be fetched from a Walrus aggregator, 404, and be reported as
      //    missing bytes — which is a different thing and sends somebody looking for the wrong one.
      const where = networkName(part.network ?? NETWORK_WHEN_UNRECORDED);
      if (where !== "walrus") {
        throw new NmtsError(
          `Part ${part.part_index} is stored on ${where ?? `an unknown network (${part.network})`}, which this version cannot read.`,
          { nextStep: "Nothing was written. Open the file in a browser, which may know that network." },
        );
      }
      if (part.storage_kind !== QUILT_PATCH && part.storage_kind !== DEDICATED_BLOB) {
        throw new NmtsError(`Part ${part.part_index} is stored in a way this version does not know (${part.storage_kind}).`);
      }
      const sealed =
        part.storage_kind === QUILT_PATCH && part.patch_id !== undefined
          ? await readQuiltPatch(input.chain, part.patch_id, input.read ?? {})
          : await readBlob(input.chain, part.blob_id, input.read ?? {});
      let plain: Uint8Array;
      try {
        plain = crypt.stream_decrypt_all(dek, sealed);
      } catch {
        throw new NmtsError(`Part ${part.part_index} did not decrypt.`, {
          nextStep:
            "The bytes that arrived are not the bytes this account sealed. Nothing was written. " +
            "Try again — a different aggregator may hold the right ones.",
        });
      }
      const isLast = i === ordered.length - 1;
      // ⛔ Every part but the last contributes all of itself. Only the last may be padded.
      const take = isLast ? remaining : plain.length;
      if (take > plain.length) {
        throw new NmtsError(
          `Part ${part.part_index} must contribute ${take} bytes and holds only ${plain.length}.`,
          { nextStep: "The file list and the stored parts do not agree. Nothing was written." },
        );
      }
      if (take > remaining) {
        throw new NmtsError(
          `Part ${part.part_index} contributes ${plain.length} bytes and only ${remaining} of the file are left.`,
          { nextStep: "The file list and the stored parts do not agree. Nothing was written." },
        );
      }
      const body = plain.subarray(0, take);
      hasher.update(body);
      kept.push(new Uint8Array(body));
      plain.fill(0);
      remaining -= take;
    }
  } finally {
    dek.fill(0);
  }

  if (remaining !== 0) {
    throw new NmtsError(`The stored parts are ${remaining} bytes short of the file this list describes.`, {
      nextStep: "Nothing was written. Open the account in a browser and compare before uploading anything again.",
    });
  }

  if (expected !== null) {
    const got = hasher.digest();
    const same = expected.length === got.length && expected.every((b, i) => b === got[i]);
    expected.fill(0);
    if (!same) {
      throw new NmtsError("The file came back whole but does not match the hash this account recorded for it.", {
        nextStep:
          "Nothing was written. Every part decrypted, so this is not a wrong key — the bytes " +
          "themselves are not the ones that were uploaded.",
      });
    }
  }

  const bytes = new Uint8Array(input.size);
  let at = 0;
  for (const chunk of kept) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes, partCount: ordered.length, contentHashChecked: expected !== null };
}
