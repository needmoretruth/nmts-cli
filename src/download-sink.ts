// Where a downloaded file's plaintext goes WHILE it is still being produced.
//
// ⛔ THE PROMISE THAT WAS KEPT BY BUFFERING IS NOW KEPT HERE. Until now `download.ts` held every
//    decrypted byte, checked the whole-file digest the account had sealed, and only then handed a
//    finished array to a caller that wrote it out. That is why a half-right file never appeared
//    under a real name. It also meant a file that could be uploaded — uploads go part by part and
//    are bounded by one part — could not be brought back on a machine smaller than the file.
//    Streaming moves bytes before the last chunk is checked, so the promise has to be kept by the
//    DESTINATION instead: a file lands under a temporary name and is renamed into place only after
//    the digest matches, and a failure takes the temporary file with it.
//
// ⛔ A SINK MUST NOT KEEP THE ARRAY IT IS HANDED. The caller zeroes each run of plaintext as soon
//    as `write` resolves, so a sink that stored the reference would hold a buffer full of zeroes
//    and write them out. Copy, or finish with the bytes before resolving.
//
// ⛔ ONLY THE SHAPE IS HERE. The two destinations this tool ships — a file on a disk, and whatever
//    is reading its stdout — are both Node's, and they live in `download-sink-node.ts`. What is
//    left is the contract, which is what a caller in a browser implements to hand a download to a
//    `Blob`, an element or a stream of its own.

/**
 * Somewhere a file's plaintext is delivered in order, and made visible only once.
 *
 * The shape is three-part on purpose: `write` moves bytes, `commit` is the only thing that may
 * make them readable under the name somebody asked for, and `abandon` must leave nothing behind.
 * A destination that cannot separate those three cannot hold the integrity promise above.
 */
export interface PlaintextSink {
  /**
   * The file's real length, from the sealed list, BEFORE a single stored part is fetched.
   *
   * ⛔ A destination that cannot take a file this size refuses HERE, where nothing has been read
   *    from the network and nothing has been written. Discovering it half way through means the
   *    refusal costs a download that was never going to be delivered.
   */
  expect(size: number): void;
  /** Take the next run of plaintext, in order. Resolves when the bytes are no longer needed. */
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Everything checked: make the file visible, or hand it over.
   *
   * False means the reader closed the pipe before the file was done — see `handOver`. Every other
   * failure throws: a caller must not be able to mistake "it stopped half way" for "delivered".
   */
  commit(): Promise<boolean>;
  /** Something did not check out: leave nothing behind. Never throws. */
  abandon(): Promise<void>;
}
