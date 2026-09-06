import type { PlaintextSink } from "./download-sink.ts";
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
export declare function fetchWithKey(input: {
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
}): Promise<FetchedFile>;
export declare function fetchFile(input: FetchInput): Promise<FetchedFile>;
