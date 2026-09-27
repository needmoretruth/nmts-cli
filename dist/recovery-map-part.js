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
const FILECOIN_CHAINS = ["calibration", "mainnet"];
/** The most copies one part may list; the reader refuses more. */
export const MAX_FILECOIN_COPIES = 12;
/** 2²⁵⁶ − 1 in decimal: the largest number the provider contracts' `uint256` holds. */
const U256_MAX_DECIMAL = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
/** A PieceCIDv2 string: `bafkzcib` then lowercase base32, at most 128 characters. */
const PIECE_CID = /^bafkzcib[a-z2-7]+$/;
const MAX_PIECE_CID_LEN = 128;
/** Whether a part uses an NRM-5 form — what makes a document need `v: 5`. */
export function usesFilecoin(part) {
    return part.network === NETWORK_NAME_FILECOIN || part.chain !== undefined || part.copies !== undefined;
}
const COPY_NUMBERS = ["provider_id", "data_set_id", "piece_id"];
/**
 * Decide a part's Filecoin fields, or say why they cannot be written. `why` finishes a sentence
 * that begins "the part …". The reader's rules, in its order: `chain` and `copies` only on a
 * Filecoin part, no Filecoin part in a quilted item, a known chain, a PieceCIDv2 `blob_id`, 1..=12
 * copies, three canonical decimal `uint256` numbers per copy, and a `retrieval_url` of
 * `https://<host>…/piece/<blob_id>` with no query or fragment.
 */
export function filecoinForm(part, inQuilt) {
    const { chain, copies } = part;
    if (part.network !== NETWORK_NAME_FILECOIN) {
        if (chain === undefined && copies === undefined)
            return { kind: "none" };
        return { kind: "refused", why: `carries chain or copies but is on ${part.network ?? "walrus"}, not filecoin` };
    }
    if (inQuilt)
        return { kind: "refused", why: "is on filecoin but its item is placed in a quilt" };
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
        if (bad)
            return { kind: "refused", why: `has a copy ${n} whose ${bad} is not a canonical decimal uint256` };
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
function isU256Decimal(s) {
    if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s))
        return false;
    return s.length < U256_MAX_DECIMAL.length || (s.length === U256_MAX_DECIMAL.length && s <= U256_MAX_DECIMAL);
}
/** `https://<host>…/piece/<cid>`: printable ASCII, no query or fragment — it must name this piece. */
function isRetrievalUrl(url, cid) {
    if (typeof url !== "string" || !url.startsWith("https://"))
        return false;
    const rest = url.slice("https://".length);
    const slash = rest.indexOf("/");
    const hostEnds = slash < 0 ? rest.length : slash;
    return hostEnds > 0 && rest.endsWith(`/piece/${cid}`) && /^[\x21-\x7e]+$/.test(url) && !/[?#]/.test(url);
}
