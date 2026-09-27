/** The network name a Filecoin part carries — the word the storage-network table registers. */
export declare const NETWORK_NAME_FILECOIN = "filecoin";
/** The Filecoin networks a part may name in `chain`. */
export type ManifestFilecoinChain = "calibration" | "mainnet";
/** The most copies one part may list; the reader refuses more. */
export declare const MAX_FILECOIN_COPIES = 12;
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
export declare function usesFilecoin(part: Pick<ManifestPartInput, "network" | "chain" | "copies">): boolean;
/** A part's Filecoin form: nothing to write, the two fields to write, or why it cannot be written. */
export type FilecoinForm = {
    readonly kind: "none";
} | {
    readonly kind: "filecoin";
    readonly chain: ManifestFilecoinChain;
    readonly copies: ManifestFilecoinCopy[];
} | {
    readonly kind: "refused";
    readonly why: string;
};
/**
 * Decide a part's Filecoin fields, or say why they cannot be written. `why` finishes a sentence
 * that begins "the part …". The reader's rules, in its order: `chain` and `copies` only on a
 * Filecoin part, no Filecoin part in a quilted item, a known chain, a PieceCIDv2 `blob_id`, 1..=12
 * copies, three canonical decimal `uint256` numbers per copy, and a `retrieval_url` of
 * `https://<host>…/piece/<blob_id>` with no query or fragment.
 */
export declare function filecoinForm(part: Pick<ManifestPartInput, "network" | "chain" | "copies" | "blob_id">, inQuilt: boolean): FilecoinForm;
