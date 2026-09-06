// Showing that one rebuilt row's key opens that row's own bytes.
//
// The RULE — why an unchecked pair is a defect and why an unknown answer is never a pass — is
// written once in `shared/lib/drive/rebuild-verify.ts`, which the browser and this tool share
// byte-for-byte. This file is only HOW this tool answers the question for one row.
//
// ⛔ IT READS 72 BYTES PER FILE, NOT A FILE. NCF-3 §4.2 puts a key commitment in the part header
//    and `StreamDecryptor` checks it in constant time before any chunk is touched, so constructing
//    a decryptor over the header ALONE is the whole answer — no ciphertext, no tag, no chunk. The
//    read is the ordinary aggregator read `nmts get` uses, with a byte range on it.
//
// ⛔ NOTHING NEW IS ASKED OF THE SERVER. `GET /v1/items/{id}/parts` is the descriptor a download
//    already fetches; it is asked here WITHOUT `?for=download`, because nothing is being
//    downloaded and the counter behind that flag is for bytes people actually take.
//
// ⛔ A FAILURE IS A VERDICT, NOT A REFUSAL. A dead aggregator, a part on a storage network this
//    build cannot read, a row the server describes strangely: each one leaves that file's key off
//    the rebuilt list and says why. None of them may stop the rebuild — an account left un-rebuilt
//    is worse than one rebuilt with a few keys withheld, and both are far better than a list that
//    seals a pairing nobody checked.
import { request } from "./api.ts";
import { AAD, DERIVED, type CryptoGlue, type StreamOpener } from "./crypto.ts";
import { asParts, fetchPart } from "./download-part.ts";
import type { SourceItem } from "./rebuild.ts";
import { NCF3_HEADER_BYTES, type PairVerdict } from "./shared/lib/drive/rebuild-verify.ts";
import type { ReadOptions } from "./walrus.ts";

export interface KeyCheckInput {
  server: string;
  apiKey: string;
  /** The account code, used once to derive the data key that opens the wrapped file keys. */
  accountCode: string;
  /** Which chain's aggregators hold the bytes — `mainnet` or `testnet`. */
  chain: string;
  read?: ReadOptions | undefined;
  crypt: CryptoGlue;
}

/**
 * A checker for this account, plus the way to forget the key it holds.
 *
 * ⛔ THE DATA KEY IS DERIVED ONCE, NOT PER FILE. Deriving it is a 64 MiB Argon2id pass; doing that
 *    per row would turn a thousand-file account into an hour of key derivation. It is held for the
 *    length of one rebuild and wiped by `done()`, which every path out of the caller reaches.
 */
export interface AccountKeyCheck {
  check(item: SourceItem): Promise<PairVerdict>;
  done(): void;
}

export function accountKeyCheck(input: KeyCheckInput): AccountKeyCheck {
  const { crypt } = input;
  const [from, to] = DERIVED.dataKey;
  const derived = crypt.kdf_derive(crypt.account_code_parse(input.accountCode));
  const dataKey = derived.slice(from, to);
  // ⛔ The whole derivation — every other key this account has — is wiped immediately. Only the
  //    32 bytes that open wrapped file keys are kept, and only until `done()`.
  derived.fill(0);

  return {
    check: (item) => checkOne(input, dataKey, item),
    done: () => dataKey.fill(0),
  };
}

async function checkOne(
  input: KeyCheckInput,
  dataKey: Uint8Array,
  item: SourceItem,
): Promise<PairVerdict> {
  const wrapped = item.dekWrapped;
  // Answered by the shared layer already; kept so this function is total on its own input.
  if (wrapped === undefined || wrapped === "") return { ok: false, reason: "no-key" };

  let header: Uint8Array;
  try {
    // ⚠ The address is written out as a literal because the gate that compares this tool's
    //   addresses against the server's registered routes reads literals.
    const described = asParts(
      await request(input.server, `/v1/items/${encodeURIComponent(item.id)}/parts`, {
        token: input.apiKey,
      }),
    );
    // ⛔ FOUND BY ITS NUMBER, NOT BY ITS POSITION. The order the rows arrive in is the server's
    //    choice, and not trusting the server's arrangement is the entire point of this check.
    const first = described.parts.find((p) => p.part_index === 0);
    if (first === undefined) return { ok: false, reason: "no-parts" };
    header = await fetchPart(first, input.chain, {
      ...(input.read ?? {}),
      range: { start: 0, end: NCF3_HEADER_BYTES },
    });
  } catch {
    // Every way the bytes did not arrive. ⛔ Not `wrong-key`: reporting a pair as wrong because an
    // aggregator was down would tell somebody their file is unopenable when it is not.
    return { ok: false, reason: "unreadable" };
  }
  if (header.length < NCF3_HEADER_BYTES) return { ok: false, reason: "unreadable" };

  let dek: Uint8Array;
  try {
    dek = input.crypt.envelope_open(
      dataKey,
      new TextEncoder().encode(AAD.dekWrap),
      Buffer.from(wrapped, "base64url"),
    );
  } catch {
    // The wrapped key does not open under this account's data key at all — so whatever it is, it
    // is not this account's key for this file.
    return { ok: false, reason: "wrong-key" };
  }

  let opener: StreamOpener;
  try {
    opener = new input.crypt.StreamDecryptor(dek, header.subarray(0, NCF3_HEADER_BYTES));
  } catch {
    // The key commitment in the header did not match this key: the pair is WRONG, not unproven.
    return { ok: false, reason: "wrong-key" };
  } finally {
    dek.fill(0);
  }
  // Nothing is fed to it — the header was the question and it has been answered.
  opener.free();
  return { ok: true };
}
