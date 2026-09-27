// One stored piece of a file in the recovery list — the wire shape of a part, and the rules its
// Filecoin form (NRM-5, NMTS Heavy) must meet to be written.
//
// ⚠ RESTATED FROM THE BROWSER'S WRITER (`web/src/lib/recovery/manifest-part.ts`), which this package
//   cannot import, and held to the same shared sample the Rust reader and the browser are held to
//   (`crypto/tests/vectors/nrm5-sample.json`). It moved out of `recovery-map.ts` because NRM-5 gave a
//   part two more fields and that file was near its length ceiling; `recovery-map.ts` re-exports it.
//
// ⛔ THE READER REFUSES THE WHOLE DOCUMENT over one Filecoin part that breaks these rules, so a list
//    a writer let one through would open nothing — on the day it is somebody's only copy. So the
//    writer applies every rule the reader applies, in the reader's order, and refuses instead.

/** The network name a Filecoin part carries — the word the storage-network table registers. */
export const NETWORK_NAME_FILECOIN = "filecoin";

/** The Filecoin networks a part may name in `chain`. */
export type ManifestFilecoinChain = "calibration" | "mainnet";
const FILECOIN_CHAINS: readonly string[] = ["calibration", "mainnet"];

/** The most copies one part may list; the reader refuses more. */
export const MAX_FILECOIN_COPIES = 12;

/** 2²⁵⁶ − 1 in decimal: the largest number the provider contracts' `uint256` holds. */
const U256_MAX_DECIMAL =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/** A PieceCIDv2 string: `bafkzcib` then lowercase base32, at most 128 characters. */
const PIECE_CID = /^bafkzcib[a-z2-7]+$/;
const MAX_PIECE_CID_LEN = 128;

/**
 * One storage company keeping a whole copy of a Filecoin part. The three numbers are decimal
 * STRINGS because the contracts count them as `uint256`; `retrieval_url` is where the company served
 * the piece when the list was written — a hint; the registry on `chain` has its current address.
 */
export interface ManifestFilecoinCopy {
  provider_id: string;
  data_set_id: string;
  piece_id: string;
  retrieval_url: string;
}

/** One stored piece of a file, in order. */
export interface ManifestPart {
  /**
   * Where this part belongs: 0 for the first, and the position it must be concatenated at
   * thereafter. Required from NRM-2.
   *
   * It is written down because array order alone cannot be CHECKED. A reader holds each fetched
   * part's 72-byte NCF-3 header, which carries the index sealed under the file key, so with this
   * field it can compare three things that must agree: the position it is writing at, what the
   * list says belongs there, and what the bytes themselves say they are.
   */
  part_index: number;
  /** Blob id holding this part's stream, in `network`'s own naming (a PieceCID on Filecoin). */
  blob_id?: string;
  /** The REAL bytes this part contributes to the file. */
  plaintext_len: number;
  /**
   * What the stored stream's header DECLARES, when the part was padded and that is larger.
   * Absent means it was not padded. New in NRM-4.
   *
   * ⛔ THE TWO NUMBERS STAY APART so that "the parts sum to exactly `size`" keeps its exact
   *    strength. Folded into one, the check softens to "at least", which accepts any size below
   *    the real one: the file comes back short and nothing says so.
   */
  padded_len?: number;
  /** On-chain blob object, when the uploading client captured it. Omitted, never null. */
  sui_object_id?: string;
  /**
   * Which storage network holds `blob_id` — a NAME (`"walrus"`, `"filecoin"`), not a code.
   *
   * A word rather than a number because whoever parses this may be doing so years from now with
   * none of our code beside them, and a bare `1` is not something a stranger can look up.
   */
  network?: string;
  /** The Filecoin network that issued `blob_id`. On a Filecoin part only, and required there (NRM-5). */
  chain?: ManifestFilecoinChain;
  /** The companies keeping a whole copy, in the order a reader tries them. Filecoin only, 1..=12. */
  copies?: ManifestFilecoinCopy[];
}

/** As a writer hands one in: the position is the value, so `part_index` is filled by the encoder. */
export interface ManifestPartInput extends Omit<ManifestPart, "part_index" | "copies"> {
  part_index?: number;
  copies?: readonly ManifestFilecoinCopy[];
}

/** Whether a part uses an NRM-5 form — what makes a document need `v: 5`. */
export function usesFilecoin(part: Pick<ManifestPartInput, "network" | "chain" | "copies">): boolean {
  return part.network === NETWORK_NAME_FILECOIN || part.chain !== undefined || part.copies !== undefined;
}

/** A part's Filecoin form: nothing to write, the two fields to write, or why it cannot be written. */
export type FilecoinForm =
  | { readonly kind: "none" }
  | { readonly kind: "filecoin"; readonly chain: ManifestFilecoinChain; readonly copies: ManifestFilecoinCopy[] }
  | { readonly kind: "refused"; readonly why: string };

const COPY_NUMBERS: readonly ("provider_id" | "data_set_id" | "piece_id")[] = ["provider_id", "data_set_id", "piece_id"];

/**
 * Decide a part's Filecoin fields, or say why they cannot be written. `why` finishes a sentence
 * that begins "the part …". The reader's rules, in its order: `chain` and `copies` only on a
 * Filecoin part, no Filecoin part in a quilted item, a known chain, a PieceCIDv2 `blob_id`, 1..=12
 * copies, three canonical decimal `uint256` numbers per copy, and a `retrieval_url` of
 * `https://<host>…/piece/<blob_id>` with no query or fragment.
 */
export function filecoinForm(
  part: Pick<ManifestPartInput, "network" | "chain" | "copies" | "blob_id">,
  inQuilt: boolean,
): FilecoinForm {
  const { chain, copies } = part;
  if (part.network !== NETWORK_NAME_FILECOIN) {
    if (chain === undefined && copies === undefined) return { kind: "none" };
    return { kind: "refused", why: `carries chain or copies but is on ${part.network ?? "walrus"}, not filecoin` };
  }
  if (inQuilt) return { kind: "refused", why: "is on filecoin but its item is placed in a quilt" };
  if (chain === undefined || !FILECOIN_CHAINS.includes(chain)) {
    return { kind: "refused", why: `is on filecoin and names no known chain (${String(chain)})` };
  }
  const cid = part.blob_id;
  if (typeof cid !== "string" || cid.length > MAX_PIECE_CID_LEN || !PIECE_CID.test(cid)) {
    return { kind: "refused", why: "is on filecoin and its blob_id is not a PieceCIDv2" };
  }
  if (copies === undefined || copies.length < 1 || copies.length > MAX_FILECOIN_COPIES) {
    return { kind: "refused", why: `is on filecoin and lists ${copies?.length ?? 0} copies, outside 1..=${MAX_FILECOIN_COPIES}` };
  }
  for (const [n, copy] of copies.entries()) {
    const bad = COPY_NUMBERS.find((field) => !isU256Decimal(copy[field]));
    if (bad) return { kind: "refused", why: `has a copy ${n} whose ${bad} is not a canonical decimal uint256` };
    if (!isRetrievalUrl(copy.retrieval_url, cid)) {
      return { kind: "refused", why: `has a copy ${n} whose retrieval_url is not https://…/piece/<blob_id>` };
    }
  }
  // Rebuilt rather than passed through, so a copy handed in with an extra key cannot reach the
  // byte output. The order is kept: it is the order a reader tries them in.
  return {
    kind: "filecoin",
    chain,
    copies: copies.map((c) => ({ provider_id: c.provider_id, data_set_id: c.data_set_id, piece_id: c.piece_id, retrieval_url: c.retrieval_url })),
  };
}

/** Digits only, no leading zero (except `"0"`), at most 2²⁵⁶ − 1 — one spelling per number. */
function isU256Decimal(s: string): boolean {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s)) return false;
  return s.length < U256_MAX_DECIMAL.length || (s.length === U256_MAX_DECIMAL.length && s <= U256_MAX_DECIMAL);
}

/** `https://<host>…/piece/<cid>`: printable ASCII, no query or fragment — it must name this piece. */
function isRetrievalUrl(url: string, cid: string): boolean {
  if (typeof url !== "string" || !url.startsWith("https://")) return false;
  const rest = url.slice("https://".length);
  const slash = rest.indexOf("/");
  const hostEnds = slash < 0 ? rest.length : slash;
  return hostEnds > 0 && rest.endsWith(`/piece/${cid}`) && /^[\x21-\x7e]+$/.test(url) && !/[?#]/.test(url);
}
