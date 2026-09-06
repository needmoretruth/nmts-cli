import { type Hash } from "node:crypto";
/** Where unfinished uploads live. */
export declare function uploadsDir(): string;
/**
 * A stable, account-scoped name for one file's upload attempt.
 *
 * Same account, same bytes, same destination give the same key — which is what lets a second `put`
 * of a file whose first attempt died find the reservation instead of paying again.
 *
 * ⛔ THE DESTINATION IS PART OF IT, and leaving it out was a real defect. Two local files with
 *    identical content — a copy, a re-download, `a.bin` and `backup/a.bin` — would otherwise share
 *    one reservation, and putting the second one would silently resume the first: it would report
 *    success, spend nothing, and write a SECOND file-list entry pointing at the FIRST file's item.
 *    Deleting either would then break the other. They are two files in the drive, so they are two
 *    uploads.
 *
 * ⚠ It is the destination AS TYPED, not the folder id, because the id needs a network round trip
 *   and this key is wanted before one. Two spellings of one folder therefore make two reservations
 *   — one extra unfinished record, never a wrong file.
 */
export declare function reservationKey(dataKey: Uint8Array, plaintext: Uint8Array, name: string, destination: string): string;
/**
 * The same key, computed without ever holding the file.
 *
 * ⛔ IT MUST HASH THE IDENTICAL BYTE SEQUENCE. A file large enough to need several parts is a file
 *    too large to hand `reservationKey` as one array, and a second construction here — hashing a
 *    hash, hashing the parts' digests — would give the same file two different keys depending on
 *    how it was read. The one above is written in terms of this one so there is only ever one
 *    answer, and a test feeds the same file both ways to hold that.
 */
export declare function reservationKeyStreamed(dataKey: Uint8Array, plaintextChunks: Iterable<Uint8Array>, name: string, destination: string): string;
/**
 * Begin the hash a reservation key is made from.
 *
 * ⛔ TWO HASHES, ONE READ. A file large enough to need parts is read once to work out its key AND
 *    the SHA-256 the account checks its contents against; handing the caller the running hash is
 *    what lets both come out of a single pass instead of two reads of a very large file.
 */
export declare function startReservationKey(dataKey: Uint8Array): Hash;
/** Finish it. The name and the destination go in last, exactly as the one-shot form does. */
export declare function finishReservationKey(hash: Hash, name: string, destination: string): string;
/**
 * The record name for ONE part of a file.
 *
 * ⛔ EVERY PART IS ITS OWN RESERVATION. Each one buys its own storage, under its own idempotency
 *    key, and can fail or resume on its own — so each one is written down on its own. Sharing a
 *    record between parts would mean a run that died between part 3 and part 4 could not say which
 *    of them the credits had already been spent on.
 */
export declare function partKey(fileKey: string, partIndex: number): string;
/** What is known about an upload that has not finished. Written before the credits move. */
export interface Reservation {
    /** The storage network's id for the sealed bytes. Deterministic in (bytes, nonce). */
    blobId: string;
    /** The relay tip nonce, base64url. Re-fed on a retry so the digest repeats. */
    nonceB64: string;
    /** Merkle root of the encoded blob, base64url. The server hands it to the chain verbatim. */
    rootHashB64: string;
    /** The relay the tip was paid to. A retry must go to the SAME one. */
    relayUrl: string;
    /** Storage term, in storage-network epochs. */
    epochs: number;
    /** Sealed byte count — what storage was bought for and what the credits counted. */
    sealedLen: number;
    /**
     * The WHOLE FILE's plaintext byte count — what the file list records.
     *
     * ⚠ NOT THIS PART'S LENGTH. A file stored in several parts has one entry in the list and that
     *   entry names the file's size; `partPlaintextLen` below is the piece this record covers. They
     *   are equal for a file that fits in one part, which is why keeping the field's meaning
     *   unchanged matters: it is read straight into the list entry.
     */
    plaintextLen: number;
    /** This part's own plaintext byte count. Equal to `plaintextLen` when the file is one part. */
    partPlaintextLen: number;
    /**
     * Where this part sits in the file — its index, and how many parts there are.
     *
     * ⛔ SEALED INTO THE BYTES, NOT JUST RECORDED HERE. NCF-3 puts both numbers in each part's
     *    header and therefore in every chunk's associated data, so a part served in another part's
     *    position fails authentication rather than decrypting into the wrong place. What is here is
     *    a copy for the resume: a run that came back has to seal the SAME piece of the file under
     *    the SAME placement, or the bytes it pushes are not the blob that was paid for.
     */
    partIndex: number;
    partTotal: number;
    /** The file's own key, wrapped. Carried so a resumed commit writes the same list entry. */
    dekWrapped: string;
    /** The sealed content hash. Same reason. */
    contentHashCt: string;
    /** The name this file is to have in the account's file list. */
    name: string;
    /** The folder id it goes in, or null for the root. */
    parentId: string | null;
    /**
     * How many reservations this file has needed. Part of the idempotency key.
     *
     * ⛔ WITHOUT IT, A FAILED RESERVATION BRICKS THIS FILE FOREVER. The idempotency key is derived
     *    from a key that is a pure function of (account, bytes, destination), and the server replays
     *    a reservation row under its key WHATEVER STATE IT IS IN — including `failed`, which can
     *    never become storage. So every later attempt would be handed the same dead row, be told to
     *    start over, start over into the same dead row, and this account could never upload this
     *    file again unless a byte of it changed. Counting up is what "start over" actually means.
     */
    attempt: number;
    /** Present once the server answered: the reservation row. */
    ledgerId?: number;
    /** Present once registered: the transaction the relay checks its tip in. */
    registerTxDigest?: string;
    /** Present once registered: the on-chain blob object. */
    blobObjectId?: string;
    /**
     * Present when the PERSON'S OWN WALLET is paying (`upload-wallet.ts`), absent on the credit rail.
     *
     * ⛔ WRITTEN SO THE OTHER RAIL REFUSES THE RECORD. The bytes and the blob id are the same
     *    whoever pays, but what "paid" means is not: a credit record names a reservation the server
     *    can be asked about, a wallet record names a transaction the person signed. A run on one
     *    rail that resumed the other's record would either buy the storage a second time or commit
     *    a part under the wrong payer.
     */
    paidFrom?: "wallet";
    /** Wallet rail: present once the certify transaction executed — the part is finished on-chain. */
    certifyTxDigest?: string;
    /** Wallet rail: the epoch the bought storage ends at, read from the blob object after registering. */
    endEpoch?: number;
}
/**
 * The waiting reservation's RECORD, without its sealed bytes.
 *
 * ⛔ THE BYTES ARE THE FILE. Reading them to answer "has this part been paid for?" would mean a
 *    resume that only needs to commit still reads every byte of a very large upload off the disk.
 *    They are fetched separately, by the one step that actually pushes them.
 */
export declare function readReservationRecord(key: string): Reservation | null;
/**
 * The sealed bytes a reservation bought.
 *
 * ⛔ NEVER RE-SEALED ONES. Sealing is non-deterministic, so bytes produced by a later run are a
 *    different blob from the one the treasury registered — the relay refuses them, forever, and
 *    the credits are gone.
 */
export declare function readReservationBytes(key: string): Uint8Array;
/** The record and its bytes together, for the callers that need both. */
export declare function readReservation(key: string): {
    record: Reservation;
    sealed: Uint8Array;
} | null;
/** Write the record and its sealed bytes. Called BEFORE the reserve, and again after it answers. */
export declare function writeReservation(key: string, record: Reservation, sealed: Uint8Array): void;
/**
 * Forget a reservation.
 *
 * ⚠ Called on success AND on a couple of failure paths, so the comment that used to say "the
 *   upload already succeeded" was not true of every caller. What IS true of all of them is that
 *   nothing further depends on the record, which is why it never throws.
 */
export declare function clearReservation(key: string): void;
/**
 * The FILE-level half of an unfinished upload: what happened after every part was paid for.
 *
 * ⛔ IT CANNOT LIVE ON A PART. Committing is one act for the whole file — one `POST /v1/items`
 *    naming every part — so "this file is committed" is not a fact about part 3. Writing it onto
 *    one arbitrary part would work until somebody reordered the resume, and then a committed file
 *    would be committed a second time.
 */
export interface ItemRecord {
    /** Present once `POST /v1/items` answered: the file exists on the server and is paid for. */
    itemId?: string;
    /**
     * How many commits this file has attempted. Part of the commit's idempotency key.
     *
     * Separate from a part's `attempt` for the same reason the record is: a part that had to buy its
     * storage twice says nothing about how many times the file was committed.
     */
    attempt: number;
}
/** What is known about this file's commit, or `null` when it has not been attempted. */
export declare function readItemRecord(fileKey: string): ItemRecord | null;
/** Write the file-level record. Called before the commit, and again once it has an id. */
export declare function writeItemRecord(fileKey: string, record: ItemRecord): void;
/** Forget the file-level record. Never throws, for the same reason `clearReservation` does not. */
export declare function clearItemRecord(fileKey: string): void;
