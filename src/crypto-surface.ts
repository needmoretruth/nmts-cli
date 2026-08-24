// What the NMTS crypto engine must provide, declared once so a missing piece is named at load
// time rather than deep inside a derivation.
//
// ⛔ SPLIT OUT OF `crypto.ts` RATHER THAN REWRITTEN. Every line below was in that file and is
//    unchanged; it moved because that file crossed the length gate, and this is where the seam
//    already was: this half is the ENGINE'S SURFACE — the shape the WebAssembly must have — and
//    what is left there is finding it on disk and loading it. Nothing here reaches the filesystem
//    and nothing here derives anything.
//
// ⛔ NO TYPE ASSERTION, and that is the reason this is a runtime check and not only a type. A
//    dynamically imported module is `unknown`; an `as` would turn a renamed export into
//    "undefined is not a function" halfway through deriving somebody's keys.

/**
 * One part's OPENING session, held open by the engine.
 *
 * `push()` the sealed bytes in any slice sizes, in order; each call returns the plaintext of
 * whatever chunks that completed, which is usually nothing and then one whole chunk. `finish()`
 * after the last byte checks every end-of-stream invariant the format has — that all chunks were
 * consumed, that the final one was flagged final, that the total matches the length in the header,
 * that nothing trails.
 *
 * ⛔ `finish()` IS NOT OPTIONAL AND IS NOT A FORMALITY. Tampering with a chunk is caught by
 *    `push()`, but a stream cut short is only caught here: every chunk that arrived authenticates
 *    perfectly and the file is simply missing its end. A caller that skipped this would accept a
 *    truncated part as a whole one.
 *
 * ⛔ `free()` IS NOT HOUSEKEEPING. The engine holds the file key for as long as the session is
 *    open, so every path out — including a failed read — has to reach it.
 */
export interface StreamOpener {
  /** Feed sealed bytes. Returns the plaintext of any chunks that completed, possibly empty. */
  push(data: Uint8Array): Uint8Array;
  /** Check the stream ended as the format requires. Throws when it did not. */
  finish(): void;
  /** Release the engine-side memory, and the key with it. */
  free(): void;
}

/**
 * One part's sealing session, held open by the engine.
 *
 * `header()`, then every `push()` output in order, then `finish()`, concatenated, IS the part's
 * complete NCF-3 stream. Nothing is buffered on this side.
 *
 * ⛔ `free()` IS NOT HOUSEKEEPING. The engine holds the file key for as long as the session is
 *    open, so a caller that abandons one leaves key material live in the engine's memory for the
 *    rest of the process. Every path out of a sealing loop — including a failed read — has to
 *    reach it.
 */
export interface StreamSealer {
  /** The stream header. Goes out first, before any chunk. */
  header(): Uint8Array;
  /** Feed plaintext. Returns whatever complete chunks that made, which may be nothing. */
  push(data: Uint8Array): Uint8Array;
  /** The buffered remainder plus the end mark. Refuses if fewer bytes were pushed than declared. */
  finish(): Uint8Array;
  /** Release the engine-side memory, and the key with it. */
  free(): void;
}

/** The slice of the engine this tool uses. Every name here is checked at load time. */
export interface CryptoGlue {
  /** A brand-new account code, display form. ⛔ The only copy there will be — `registration.ts`. */
  account_code_generate(): string;
  /** Text form to the 20 raw bytes. Throws when the check symbol does not match. */
  account_code_parse(input: string): Uint8Array;
  /** The grouped, human-readable spelling of a code. */
  account_code_display(codeBytes: Uint8Array): string;
  /** The full derivation output. Offsets are named in DERIVED below. */
  kdf_derive(codeBytes: Uint8Array): Uint8Array;
  /** Display form — the grouped PUBLIC CODE a person reads, copies and types. */
  share_address_display(address: Uint8Array): string;
  /**
   * The typed form back to the 16 raw bytes. Throws when the check symbol does not match.
   *
   * ⛔ A TYPO FAILS HERE, NOT AS A SERVER LOOKUP. Sending a mistyped address to the recipient
   *    lookup would ask the server a question about somebody who may exist, and the answer — or
   *    the refusal — is not ours to collect.
   */
  share_address_parse(input: string): Uint8Array;
  /**
   * This account's published sharing identity: the 4,989-byte bundle other people encrypt to.
   *
   * ⛔ DETERMINISTIC, AND THAT IS LOAD-BEARING (NCF-3 §5.1). The self-signature uses the
   *    deterministic signing variant, so the same account code produces the same bytes on every
   *    machine. A hedged signature would make each device publish a different identity, and the
   *    server takes the first one forever.
   */
  share_public_key(
    shareKemSeed: Uint8Array,
    shareAuthSecret: Uint8Array,
    shareSigSeed: Uint8Array,
  ): Uint8Array;
  /** The address an identity bundle fingerprints to. Used to check what a server handed back. */
  share_address_of(recipientPublic: Uint8Array): Uint8Array;
  /** Which account an envelope CLAIMS to be from. A claim until the unwrap succeeds. */
  share_claimed_sender(envelope: Uint8Array): Uint8Array;
  /**
   * Wrap a file's key to one recipient.
   *
   * ⛔ THE ADDRESS IS AN ARGUMENT BECAUSE THE IDENTITY IS NOT TRUSTED. The server hands back a
   *    bundle; this checks it fingerprints to the address that was asked for, that it
   *    self-signs, and that its halves decode, BEFORE encrypting anything to it (NCF-3 §5.2a).
   *    There is deliberately no form of this that takes the bundle alone.
   *
   * ⛔ THE LAST THREE ARGUMENTS MUST BE THE BYTES ACTUALLY SENT. They are hashed, with length
   *    prefixes, into the wrapping key — so a name sealed after this call, or an id spelled
   *    differently, produces an envelope the recipient cannot open.
   */
  share_wrap_dek(
    senderAuthSecret: Uint8Array,
    senderSigSeed: Uint8Array,
    recipientPublic: Uint8Array,
    recipientAddress: Uint8Array,
    dek: Uint8Array,
    itemId: string,
    nameShareCt: Uint8Array,
    contentHashShareCt: Uint8Array,
  ): Uint8Array;
  /**
   * Open an envelope somebody sent to this account.
   *
   * ⛔ OPENING IT IS THE AUTHENTICATION. There is no separate verify step: the sender's secret is
   *    inside the key agreement, so a bundle that is not the real sender's cannot produce a key
   *    that opens this. That is why the claimed sender may only be printed AFTER this succeeds.
   */
  share_unwrap_dek(
    shareKemSeed: Uint8Array,
    shareAuthSecret: Uint8Array,
    shareSigSeed: Uint8Array,
    senderPublic: Uint8Array,
    envelope: Uint8Array,
    itemId: string,
    nameShareCt: Uint8Array,
    contentHashShareCt: Uint8Array,
  ): Uint8Array;
  /**
   * Open one NCF-3 envelope: key, the associated data it was sealed with, the envelope bytes.
   *
   * ⛔ The associated data is not decoration. An envelope sealed for one purpose cannot be opened
   *    as another, so passing the wrong string here does not silently produce wrong plaintext —
   *    it throws. That is why the strings live in one table (`AAD`) rather than at call sites.
   */
  envelope_open(key: Uint8Array, aad: Uint8Array, envelope: Uint8Array): Uint8Array;
  /**
   * Decrypt one whole NCF-3 stream — header, every chunk, and the end-of-stream check.
   *
   * ⚠ IT HOLDS THE WHOLE PART OPEN IN MEMORY as well as sealed, which is why the download path
   *   stopped using it: a file is delivered as it is decrypted now, through `StreamDecryptor`
   *   below. This stays because the conformance tests seal a part and open it again in one line,
   *   and reading that test is how a person checks the streaming path against the simple one.
   */
  stream_decrypt_all(dek: Uint8Array, stream: Uint8Array): Uint8Array;
  /**
   * A fresh random 32-byte file key.
   *
   * ⛔ THE RANDOMNESS IS THE ENGINE'S, NOT THIS FILE'S. Node has its own generator, and reaching
   *    for it here would put a second source of file keys in the world -- one this package's
   *    conformance vectors say nothing about. One generator, inside the engine, for both the
   *    browser and this tool.
   */
  generate_dek(): Uint8Array;
  /**
   * Seal one NCF-3 envelope: key, the associated data to bind it to, the plaintext.
   *
   * The inverse of `envelope_open`, and the same warning applies to the associated data -- an
   * envelope sealed under the wrong string is not openable as the thing it was meant to be.
   */
  envelope_seal(key: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array;
  /**
   * Encrypt one whole part into a complete NCF-3 stream -- header, chunks and the end mark.
   *
   * ⚠ IT HOLDS THE WHOLE PART IN MEMORY, open and sealed, exactly as `stream_decrypt_all` does.
   *   That is what bounds the size this tool will upload in one piece; `put` refuses a larger file
   *   rather than discovering the limit as an out-of-memory crash halfway through.
   *
   * ⛔ A FRESH CALL PER PART. The nonce prefix is allocated inside, and the format requires it to
   *   differ per stream. Re-sealing different bytes under a header that was already used is the
   *   one catastrophic mistake available here, so there is no entry point that accepts a header.
   */
  stream_encrypt_all(dek: Uint8Array, plaintext: Uint8Array): Uint8Array;
  /**
   * Seal ONE part of a file, feeding the plaintext in as it is read.
   *
   * ⛔ THIS IS WHAT LETS A FILE BE LARGER THAN MEMORY. `stream_encrypt_all` above needs the whole
   *    part open and sealed at once; this holds one chunk at a time, so the caller can read a
   *    file in slices and never have more than a chunk of it live.
   *
   * ⛔ A FRESH SESSION PER PART, ALWAYS. The nonce prefix is allocated inside the engine and the
   *    format requires it to differ per stream. There is deliberately no entry point here that
   *    accepts a header: re-sealing DIFFERENT bytes under a header that was already used repeats
   *    a (key, nonce) pair, which is the one mistake in this format that loses the file's secrecy
   *    outright rather than making it unreadable.
   *
   * `partIndex` and `partTotal` say where this stream sits in the file. They go into the header
   * and therefore into every chunk's associated data, so a part later served in another part's
   * position fails authentication instead of decrypting into the wrong place. A whole file in one
   * stream is part 0 of 1.
   */
  StreamEncryptor: new (
    dek: Uint8Array,
    plaintextLen: number,
    partIndex: number,
    partTotal: number,
  ) => StreamSealer;
  /**
   * OPEN one part of a file, handing back its plaintext as the bytes arrive.
   *
   * ⛔ THIS IS WHAT LETS A FILE COME BACK ON A MACHINE SMALLER THAN THE FILE. The mirror of
   *    `StreamEncryptor`, and the download path's only decryptor: `stream_decrypt_all` needs the
   *    whole part open at once, so the size a file could be uploaded at and the size it could be
   *    read back at had drifted apart.
   *
   * `header` is the first 72 bytes of the stored stream and is parsed and checked here — a wrong
   * magic, an unknown version or an impossible chunk size fails at construction, before any
   * ciphertext is fed in.
   */
  StreamDecryptor: new (dek: Uint8Array, header: Uint8Array) => StreamOpener;
  /**
   * The Ed25519 seed of wallet `index`, from the 32-byte wallet root (NCF-3 §1).
   *
   * ⛔ EVERY WALLET COMES FROM HERE, INCLUDING WALLET 0. There is no separate rule for the first
   *    one and no index this refuses. A tool that derived wallet 0 some other way would produce a
   *    different address from the browser and the recovery tool for the same account code — which
   *    would look like the account's money had vanished.
   */
  wallet_seed_for(walletRoot: Uint8Array, index: number): Uint8Array;
}

const REQUIRED: readonly (keyof CryptoGlue)[] = [
  "account_code_generate",
  "account_code_parse",
  "account_code_display",
  "kdf_derive",
  "share_address_display",
  "share_address_parse",
  "share_public_key",
  "share_address_of",
  "share_claimed_sender",
  "share_wrap_dek",
  "share_unwrap_dek",
  "envelope_open",
  "stream_decrypt_all",
  "generate_dek",
  "envelope_seal",
  "stream_encrypt_all",
  "StreamEncryptor",
  "StreamDecryptor",
  "wallet_seed_for",
];

export function isCryptoGlue(value: unknown): value is CryptoGlue {
  return missingExports(value).length === 0;
}

/** Which of the required functions this object does not have. Empty means it is the engine. */
export function missingExports(value: unknown): (keyof CryptoGlue)[] {
  if (typeof value !== "object" || value === null) return [...REQUIRED];
  return REQUIRED.filter((name) => {
    if (!(name in value)) return true;
    const member: unknown = Reflect.get(value, name);
    return typeof member !== "function";
  });
}

/**
 * Where the engine is.
 *
 * Two layouts are real: inside the published package the vendored engine sits beside the code, and
 * inside this repository it lives in web/vendor where the browser build also reads it. Looking in
 * both is what lets the same source run from a checkout and from an install.
 */
