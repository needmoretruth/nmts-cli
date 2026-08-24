// The shapes the credit-paid upload speaks in — the storage-network protocol, the api calls, and
// what a failure is allowed to claim about money.
//
// ⛔ SEPARATE FROM THE MACHINE ON PURPOSE. `upload.ts` is a sequence of decisions about spending;
//    keeping the vocabulary here means a test can name every seam without importing that sequence,
//    and means the file that DOES spend stays short enough to read in one sitting.

import { NmtsError } from "./errors.ts";

/** What the storage network's encoder says about one sealed blob, before anything is bought. */
export interface BlobMeta {
  /** The network's own id for these bytes. Deterministic in (bytes, nonce). */
  blobId: string;
  /** Merkle root of the encoded blob. Handed to the chain service verbatim. */
  rootHash: Uint8Array;
  /** The relay tip nonce. Random on a first encode, re-fed on a retry so the digest repeats. */
  nonce: Uint8Array;
  /** What the relay checks the paid tip against. */
  blobDigest: Uint8Array;
}

/** What the storage nodes signed. Passed to the server unread — this tool never interprets it. */
export interface Certificate {
  signers: number[];
  serialized_message_b64: string;
  signature_b64: string;
}

/** The Walrus protocol seam. The real one is in `walrus-write.ts`; the tests supply a fake. */
export interface BlobProtocol {
  computeMetadata(input: { bytes: Uint8Array; nonce?: Uint8Array | undefined }): Promise<BlobMeta>;
  uploadToRelay(input: {
    blobId: string;
    bytes: Uint8Array;
    nonce: Uint8Array;
    registerTxDigest: string;
    blobObjectId: string;
  }): Promise<Certificate>;
}

/** The reservation as the server describes it. */
export interface ReserveReply {
  ledger_id: number;
  state: string;
  blob_object_id?: string;
  register_tx_digest?: string;
  credits_spent: number;
}

/** The resume surface. */
export interface StatusReply {
  ledger_id: number;
  state: string;
  blob_object_id?: string;
  register_tx_digest?: string;
}

/** The api calls this rail makes. */
export interface UploadApi {
  reserve(body: {
    idempotency_key: string;
    blob_id: string;
    root_hash_b64: string;
    size: number;
    epochs: number;
    relay: { host: string; blob_digest_b64: string; nonce_b64: string };
  }): Promise<ReserveReply>;
  status(ledgerId: number): Promise<StatusReply>;
  uploaded(ledgerId: number, certificate: Certificate): Promise<unknown>;
  createItem(
    body: {
      size: number;
      dek_wrapped: string;
      content_hash_ct: string;
      visibility: number;
      parts: readonly Record<string, unknown>[];
    },
    idempotencyKey: string,
  ): Promise<{ id: string }>;
}

/** Where an upload stopped. The phase is what makes the message say the right true thing. */
export type UploadPhase = "encoding" | "reserve" | "uploading" | "certify" | "committing";

/** Told about each step, so a person watching a slow upload sees it moving. */
export type UploadStep =
  | { step: "encoding"; bytes: number }
  | { step: "reserving" }
  | { step: "uploading"; relayUrl: string; bytes: number }
  | { step: "certifying" }
  | { step: "committing" }
  | { step: "resuming"; ledgerId: number; state: string };

/**
 * A failure that names its phase — and, crucially, whether the account has already paid.
 *
 * ⛔ `paid` IS NOT COSMETIC. Before the reserve, a failure costs nothing and "try again" is honest
 *    advice. After it, the credits are gone and the storage exists; the honest advice is that the
 *    same command will FINISH it rather than buy it again, and that saying otherwise would send
 *    somebody to spend twice.
 */
export class UploadError extends NmtsError {
  readonly phase: UploadPhase;
  readonly paid: boolean;

  constructor(input: { phase: UploadPhase; message: string; paid: boolean; nextStep?: string | null }) {
    super(input.message, { exitCode: 1, nextStep: input.nextStep ?? null });
    this.name = "UploadError";
    this.phase = input.phase;
    this.paid = input.paid;
  }
}

/**
 * What making the FILE needs — everything that is true of the whole upload rather than one part.
 *
 * ⛔ THE ENTRY IS NOT REBUILT PER RUN. What is stored on the network is one particular sealing of
 *    the file, under one particular file key. A resumed run that wrote its own freshly generated
 *    key into the list would produce a file that is paid for, present, correctly named — and
 *    impossible to open, because the key in the list would not be the key the bytes were sealed
 *    with. It comes off the record that was written before the first reservation.
 */
export interface CommitInput {
  api: UploadApi;
  /** Storage term in storage-network epochs. */
  epochs: number;
  /** The current storage-network epoch, or null when it could not be read. */
  currentEpoch: number | null;
  /** Everything the file list will need, carried through so a resumed run writes the same entry. */
  entry: {
    name: string;
    parentId: string | null;
    plaintextLen: number;
    dekWrapped: string;
    contentHashCt: string;
  };
  onStep?: (step: UploadStep) => void;
}

export interface UploadInput extends CommitInput {
  protocol: BlobProtocol;
  /** The stable, account-scoped name for THIS PART — see `upload-store.ts`. */
  key: string;
  /**
   * The sealed NCF-3 stream for this part. These exact bytes are what gets stored.
   *
   * ⛔ ON A RESUME THE CALLER MUST PASS THE STORED BYTES, not a fresh sealing. Sealing is
   *    non-deterministic — a new file key and a new nonce every time — so re-sealing produces a
   *    DIFFERENT blob id, and the relay refuses bytes that are not the blob the treasury paid to
   *    register. `upload-store.ts` keeps them for exactly this.
   */
  sealed: Uint8Array;
  /**
   * The relay this run writes through when the reservation is new.
   *
   * ⚠ IGNORED ON A RESUME. The tip was paid to whichever relay the first attempt chose, and it is
   *   recorded; pushing to a different one is pushing bytes nobody tipped that relay for.
   */
  relayUrl: string;
  /**
   * Where these sealed bytes sit in the file. A file that fits in one blob is part 0 of 1.
   *
   * ⛔ IT IS ALREADY SEALED INTO THE BYTES. NCF-3 writes both numbers into the part's header, so
   *    this is not where the placement is decided — it is a copy the record keeps so a resumed run
   *    can check it is about to push the same piece of the same file.
   */
  part: { index: number; total: number; plaintextLen: number };
}

/**
 * ONE part that is bought, pushed and certified — everything the commit needs to name it.
 *
 * ⛔ IT IS NOT A FINISHED FILE. Nothing in the account can see these bytes yet: a file becomes
 *    real when `POST /v1/items` names every one of its parts at once. A part that stopped here is
 *    storage that is paid for and filled, waiting for the rest of the file.
 */
export interface PaidPart {
  /** Its position in the file. */
  partIndex: number;
  /** The reservation row that paid for it. */
  ledgerId: number;
  /** The storage network's id for its sealed bytes. */
  blobId: string;
  /** How many sealed bytes it is — what the credits were charged on. */
  sealedLen: number;
  /** True when this run did not have to spend on it, because a previous one already had. */
  resumed: boolean;
}

/** What finished. The caller writes the file list, THEN clears the records. */
export interface UploadResult {
  itemId: string;
  /** True when no part of this run had to spend, because a previous one already had. */
  resumed: boolean;
  /** The reservation rows, for a message that can be checked against the account screen. */
  ledgerIds: readonly number[];
  /**
   * The account-scoped name this upload's records were filed under, and how many parts it had.
   *
   * ⛔ HANDED BACK RATHER THAN RECOMPUTED. Working it out again needs the account's data key and
   *    another full read of the file, and the caller wipes that key the moment the upload returns.
   *    A caller that could not name the records could not clear them, and an uncleared record is
   *    resumed by the next run instead of being overwritten.
   */
  fileKey: string;
  parts: number;
  /**
   * What the FILE LIST must record — taken from the reservation, not from this run.
   *
   * ⛔ THE CALLER MUST WRITE THESE AND NOT ITS OWN. What is stored on the network is one
   *    particular sealing of the file, under one particular file key. A resumed run that wrote its
   *    own freshly generated key into the list would produce a file that is paid for, present,
   *    correctly named — and impossible to open, because the key in the list would not be the key
   *    the stored bytes were sealed with. Returning them is what makes that mistake unavailable.
   */
  entry: {
    name: string;
    parentId: string | null;
    plaintextLen: number;
    dekWrapped: string;
    contentHashCt: string;
  };
}
