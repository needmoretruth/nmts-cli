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
//
// ⛔⭐ THE FILE IS NEVER HELD, AND THE INTEGRITY PROMISE MOVED RATHER THAN WEAKENED. This used to
//    keep every decrypted byte, check the whole-file digest, and hand back a finished array — so
//    nothing wrong could ever reach a destination. It also meant a file that could be UPLOADED
//    (part by part, bounded by one part) could not be brought back on a machine smaller than the
//    file: the ceiling had simply moved to the other direction. Plaintext now flows to a
//    `PlaintextSink` as it is produced, and the promise is kept by the destination instead — a
//    file lands under a temporary name in the destination's own directory and is renamed into
//    place only after the digest matches, and `--out -` still proves the whole file before it
//    hands over a byte because a pipe has no rename (`download-sink.ts` carries both arguments).
//
// ⛔ WHAT ONE DOWNLOAD COSTS IN MEMORY IS NOW ONE PART PLUS ONE CHUNK, not the file: the sealed
//    bytes of the part being read (64 MiB by default, whatever `--part-size` the uploader chose),
//    the engine's own buffer for the chunk it is assembling, and the one chunk of plaintext it
//    hands back — 4 MiB each in NCF-3. A hundred-gigabyte file costs the same as a hundred-megabyte
//    one. The exception is `--out -`, which is bounded by `STDOUT_HOLD_LIMIT` and refuses above it.
import { createHash } from "node:crypto";

import { request } from "./api.ts";
import { AAD, type CryptoGlue, DERIVED, loadCrypto } from "./crypto.ts";
import { asParts, fetchPart, openPart, type PartView } from "./download-part.ts";
import type { PlaintextSink } from "./download-sink.ts";
import { NmtsError } from "./errors.ts";
import type { ReadOptions } from "./walrus.ts";

export interface FetchedFile {
  /**
   * How many plaintext bytes were delivered — the file's real length.
   *
   * ⚠ A COUNT, NOT THE BYTES. There is deliberately nothing here to read the file out of: the
   *   plaintext went to the sink as it was produced and was zeroed behind it, and a field holding
   *   it would put the ceiling this module exists to remove straight back.
   */
  byteCount: number;
  /** How many stored objects it came from. */
  partCount: number;
  /** Whether the file's own sealed hash was there to check against, and matched. */
  contentHashChecked: boolean;
  /**
   * Whether the whole file reached its destination.
   *
   * False has exactly one meaning: the program reading `--out -` closed the pipe before the file
   * was done, which is an ordinary end and not a failure (`handOver`). Anything else throws.
   */
  delivered: boolean;
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
  /** Where the plaintext goes as it is decrypted. Committed only after the whole file checks out. */
  sink: PlaintextSink;
}

/**
 * Fetch, decrypt and verify one file.
 *
 * The account code is used and not kept: the data key is derived, unwrapped keys are zeroed, and
 * the derivation output — which holds every other key in the account — never outlives this call.
 */
/**
 * Fetch, decrypt and verify one file whose key is ALREADY OPEN.
 *
 * ⛔ SPLIT OUT BECAUSE THERE ARE TWO WAYS TO GET THAT KEY, and only one of them belongs to the
 *    account holding it. A file this account owns has its key wrapped in its own sealed list; a
 *    file somebody SHARED has its key inside an envelope only this account can open, sealed under
 *    a different separator, and its real length comes from what the sender sealed rather than from
 *    the account's own list. Everything after the key is identical — and writing it twice is how
 *    one copy comes to check the hash and the other does not.
 */
export async function fetchWithKey(input: {
  base: string;
  apiKey: string;
  /** Where the server describes the stored parts. Different for an owned and a shared file. */
  descriptorPath: string;
  /** The file's REAL plaintext length. */
  size: number;
  /** The file's own key, already unwrapped. Wiped here. */
  dek: Uint8Array;
  /** The whole-plaintext digest to check against, or null when none was recorded. */
  expected: Uint8Array | null;
  chain: string;
  read?: ReadOptions;
  /** Where the plaintext goes as it is decrypted. Committed only after the whole file checks out. */
  sink: PlaintextSink;
}): Promise<FetchedFile> {
  const described = asParts(await request(input.base, input.descriptorPath, { token: input.apiKey }));
  if (described.parts.length === 0) {
    throw new NmtsError("The server says this file has no stored parts.", {
      nextStep: "Nothing was written. The file list names it, so open the account in a browser and compare.",
    });
  }
  // ⛔ The server's `size` is a hint; the length the caller was given is the authority.
  const ordered = [...described.parts].sort((a, b) => a.part_index - b.part_index);
  const crypt = await loadCrypto();
  const dek = input.dek;
  const expected = input.expected;
  return collect(crypt, ordered, dek, expected, input.size, input.chain, input.read, input.sink);
}

export async function fetchFile(input: FetchInput): Promise<FetchedFile> {
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

  return fetchWithKey({
    base: input.base,
    apiKey: input.apiKey,
    descriptorPath: `/v1/items/${encodeURIComponent(input.itemId)}/parts?for=download`,
    size: input.size,
    dek,
    expected,
    chain: input.chain,
    sink: input.sink,
    ...(input.read === undefined ? {} : { read: input.read }),
  });
}

/**
 * Read every part, open it as it arrives, pass on exactly what it contributes, and check the
 * whole against a hash before any of it is made visible.
 *
 * ⛔ ONLY THE LAST PART MAY BE PADDED. Every part but the last contributes all of itself; the last
 *    is trimmed to what is left of the file. That is the write side's promise, and it is what
 *    makes the arithmetic have one answer instead of several.
 *
 * ⛔ THE SINK IS COMMITTED IN EXACTLY ONE PLACE — after the parts add up AND the digest matches —
 *    and abandoned on every other way out of this function. That pairing is the whole of the
 *    integrity guarantee now that bytes move before the last chunk is checked: a reader either
 *    sees the finished file or sees nothing under that name.
 */
async function collect(
  crypt: CryptoGlue,
  ordered: readonly PartView[],
  dek: Uint8Array,
  expected: Uint8Array | null,
  size: number,
  chain: string,
  read: ReadOptions | undefined,
  sink: PlaintextSink,
): Promise<FetchedFile> {
  const hasher = createHash("sha256");
  let remaining = size;
  try {
    // ⛔ Asked before a byte is fetched. A destination that cannot take a file this size says so
    //    now, while "nothing was written" is still free.
    sink.expect(size);
    for (let i = 0; i < ordered.length; i += 1) {
      const part = ordered[i];
      if (part === undefined) continue;
      const sealed = await fetchPart(part, chain, read);
      remaining -= await openPart(crypt, dek, part, sealed, i === ordered.length - 1, remaining, async (body: Uint8Array) => {
        hasher.update(body);
        await sink.write(body);
      });
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

    const delivered = await sink.commit();
    return { byteCount: size, partCount: ordered.length, contentHashChecked: expected !== null, delivered };
  } catch (failure) {
    // ⛔ EVERY way out that is not the commit above leaves nothing behind — a wrong network, a
    //    part that would not open, arithmetic that does not add up, a digest that does not match,
    //    a disk that filled. This is the one place that knows the download did not finish.
    await sink.abandon();
    throw failure;
  } finally {
    dek.fill(0);
  }
}
