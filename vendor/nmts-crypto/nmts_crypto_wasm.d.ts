/* tslint:disable */
/* eslint-disable */

/**
 * Incremental SHA-256 over a file's PLAINTEXT, for the content-hash envelope
 * (`docs/CRYPTO-FORMAT-NCF3.md` §3).
 *
 * WHY STREAMING: the one-shot `sha256` needs the whole file in memory at once. Uploads run
 * to many gigabytes and parts may be encrypted concurrently, so the hash is accumulated by
 * a separate sequential pass that never holds more than one slice. `update()` in order,
 * then `finalize()` exactly once. Call `free()` afterwards to release the wasm-side memory.
 *
 * Not key material: the digest is of plaintext the caller already holds. It is the SEALED
 * form (see `wrap::seal_content_hash`) that ever reaches the server.
 */
export class Sha256Hasher {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The 32-byte digest. Consumes the state — calling twice errors rather than returning
     * the digest of a silently restarted hasher.
     */
    finalize(): Uint8Array;
    /**
     * A fresh hasher with empty state.
     */
    constructor();
    /**
     * Absorb the next plaintext slice, in order. Any slice size.
     */
    update(data: Uint8Array): void;
}

/**
 * Streaming sequential NCF-3 decryptor with full anti-truncation/reorder verification
 * (the download path). Construct with the file DEK and the 72-byte stream header,
 * `push()` ciphertext in arbitrary slice sizes — each call returns decrypted plaintext
 * for any chunks that completed — then call `finish()` after the last byte: it enforces
 * every end-of-stream invariant (all chunks consumed, final chunk flagged, decoded total
 * equals `plaintext_len`, no trailing bytes). Call `free()` afterwards.
 */
export class StreamDecryptor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Verifies the stream ended cleanly (end-of-stream invariants above). Errors on an
     * incomplete or oversized stream; idempotent after a successful call (mirrors Rust).
     */
    finish(): void;
    /**
     * `dek` must be 32 bytes; `header` the 72-byte NCF-3 stream header (parsed and
     * validated here — bad magic/version/chunk size error immediately).
     */
    constructor(dek: Uint8Array, header: Uint8Array);
    /**
     * Feeds ciphertext in. Returns decrypted plaintext for any chunks that completed
     * (possibly empty). Tampering, reordering, and truncation surface as errors here.
     */
    push(data: Uint8Array): Uint8Array;
}

/**
 * Streaming NCF-3 encryptor (misuse-resistant by construction): the random
 * `nonce_prefix` is generated INSIDE Rust and chunk indexes are managed internally, so a
 * JS-side bug can never cause nonce reuse or out-of-order sealing.
 *
 * Protocol (CRYPTO-FORMAT §3): construct with the file DEK and the total plaintext
 * length, emit `header()` (32 bytes) first, `push()` plaintext in arbitrary slice sizes —
 * each call returns any now-complete sealed NON-final chunks (possibly empty) — then call
 * `finish()` exactly once for the remaining sealed bytes including the final chunk.
 * `header || push outputs || finish output`, concatenated in order, is the complete
 * stream. Call `free()` afterwards to release the wasm-side memory.
 */
export class StreamEncryptor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Total chunk count for this stream: `max(1, ceil(plaintext_len / chunk_size))`.
     */
    chunk_count(): number;
    /**
     * Flushes any buffered chunks plus the final chunk (sealed with `is_final = 0x01`).
     * Errors if fewer than `plaintext_len` bytes were pushed. A second call returns an
     * empty array (idempotent — mirrors the Rust engine's `finish`).
     */
    finish(): Uint8Array;
    /**
     * The 32 plaintext header bytes (magic/version/log2/plaintext_len/nonce_prefix).
     * Emit these first, before any chunk output. On a resume handle these are the SAME
     * bytes passed to `resumeFromHeader`.
     */
    header(): Uint8Array;
    /**
     * `dek` must be 32 bytes; `plaintext_len` a non-negative integer ≤ 2^53. Uses the
     * production constructor only: fresh random nonce prefix, chunk_size_log2 = 22
     * (4 MiB) — callers can never supply nonces or chunk sizes.
     *
     * `part_index` and `part_total` say WHERE this blob sits in the file (NCF-3 §4.1, defect
     * A4). They go into the header and therefore into every chunk's AAD, so a part that is
     * later served in another part's position fails authentication instead of decrypting into
     * the wrong place. A whole file in one blob is part 0 of 1.
     *
     * The pair is validated HERE rather than left to Rust's debug assertion: an impossible
     * placement panics inside the engine, and a panic across the wasm boundary aborts the
     * worker rather than raising something the caller can handle.
     */
    constructor(dek: Uint8Array, plaintext_len: number, part_index: number, part_total: number);
    /**
     * Feeds plaintext in. Returns the sealed bytes (`ciphertext||tag` each) of any chunks
     * that became complete — possibly empty. Errors if more than `plaintext_len` bytes
     * are pushed in total.
     */
    push(data: Uint8Array): Uint8Array;
    /**
     * ☠️ RESUME RE-DERIVATION ONLY. Reconstructs an encryptor from a PERSISTED 72-byte NCF-3
     * header so a cross-reload resume can re-derive a registered part's EXACT ciphertext.
     * Validates the header like the parser (magic/version/chunk_size_log2/plaintext_len) and
     * re-emits those same 32 header bytes; seeds the nonce prefix + chunk sizing from it and
     * starts at chunk index 0.
     *
     * The caller MUST NOT transmit any output unless its Walrus blobId bit-matches the
     * originally registered blobId — reusing `(DEK, nonce_prefix)` for DIFFERENT plaintext is
     * catastrophic. This is NEVER a fresh-upload path (use the constructor, random nonce).
     * See `ResumeEncryptor`'s safety note for the full rationale.
     */
    static resumeFromHeader(dek: Uint8Array, header: Uint8Array): StreamEncryptor;
}

/**
 * The display string for a set of 20 raw account-code bytes.
 */
export function account_code_display(code_bytes: Uint8Array): string;

/**
 * Generates a fresh 160-bit account code and returns its display string
 * (`XXXX-XXXX-…-XXXXC`). The bytes never leave the worker except as this one-time string.
 */
export function account_code_generate(): string;

/**
 * Parses+validates a user-entered account code (any spacing/case), returning the 20 raw
 * bytes. Errors if the check symbol fails.
 */
export function account_code_parse(input: string): Uint8Array;

/**
 * Unpadded base64url of arbitrary bytes. The textual `accountId` is
 * `b64_encode(account_id_16_bytes)`.
 */
export function b64_encode(data: Uint8Array): string;

/**
 * Derives the 32-byte wrapping key for a passphrase-protected "remember this device" record.
 *
 * `salt` is 16 bytes the CALLER generated fresh for that record and stores beside the
 * ciphertext — a human-chosen passphrase must never share a salt with another user's (see
 * `kdf::derive_device_wrap_key`). Errors on a short passphrase or a wrong-length salt rather
 * than deriving something weak.
 *
 * The returned key is ordinary bytes: the browser imports it into WebCrypto to seal the record
 * and drops it. It is NOT an account key and reaches nothing an account key reaches.
 */
export function device_wrap_key(passphrase: Uint8Array, salt: Uint8Array): Uint8Array;

/**
 * Decrypts and authenticates an envelope (`nonce||ct||tag`) under `key`, checking `aad`.
 */
export function envelope_open(key: Uint8Array, aad: Uint8Array, envelope: Uint8Array): Uint8Array;

/**
 * Encrypts `plaintext` under `key` with a FRESH random 24-byte nonce (production path).
 */
export function envelope_seal(key: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Uint8Array;

/**
 * A fresh random 32-byte file DEK (WebCrypto-backed).
 */
export function generate_dek(): Uint8Array;

/**
 * Chunk count derived from a validated header: `max(1, ceil(plaintext_len/chunk_size))`.
 * Errors on a malformed header or a count beyond 2^53.
 */
export function header_chunk_count(header: Uint8Array): number;

/**
 * Chunk size in bytes from a validated header (`1 << chunk_size_log2`; 4 MiB in v1).
 * Errors on a malformed header. Always a power of two, hence exact as a JS number.
 */
export function header_chunk_size(header: Uint8Array): number;

/**
 * Where this part sits in its file, and how many parts the file has (NCF-3 §4.1).
 * Exposed so the download path can show and check placement without decrypting anything.
 */
export function header_part_index(header: Uint8Array): number;

export function header_part_total(header: Uint8Array): number;

/**
 * `plaintext_len` from a validated 32-byte header (u64 LE at offset 8). Errors on a
 * malformed header, or on a declared length beyond 2^53 (not a JS-safe integer).
 */
export function header_plaintext_len(header: Uint8Array): number;

/**
 * Derives the account keys from the 20 raw account-code bytes (NCF-3 §1).
 *
 * Returns one concatenated buffer (`KDF_DERIVE_LEN` = 256 bytes) the caller slices:
 * ```text
 *   0.. 16  account_id         public — the server's lookup key
 *  16.. 48  auth_secret        secret — sent to the server over TLS at login
 *  48.. 80  data_key           secret — wraps every file DEK; NEVER leaves the worker
 *  80..112  file_list_key      secret — opens the sealed drive index, and nothing else
 * 112..144  share_kem_seed     secret — X-Wing seed for private sharing (NCF-3 §5.1)
 * 144..176  share_auth_secret  secret — proves this account SENT a share (NCF-3 §5.5)
 * 176..208  wallet_root        secret — parent of EVERY wallet, including the first
 * 208..224  share_address      public — the address a user hands out to be shared with
 * 224..256  share_sig_seed     secret — ML-DSA-44 seed; its key IS the identity root (§5.2a)
 * ```
 * Every secret region above must be retained inside the crypto worker and never cross the
 * postMessage boundary.
 *
 * ⚠ **This layout only ever grows at the TAIL.** `share_sig_seed` was appended in 2026-08-02
 * rather than filed beside the other two share secrets, where it would read better, because
 * inserting it there would shift `wallet_root` and `share_address` and every constant on the
 * JS side would be silently wrong about which 32 bytes it was holding. Readability loses to
 * that, every time.
 *
 * `share_address` is included even though it is not an HKDF output: since NCF-3 it is the
 * FINGERPRINT of the share identity's root (§5.2), and computing it here means the browser never
 * has to decide for itself which key an address belongs to.
 */
export function kdf_derive(code_bytes: Uint8Array): Uint8Array;

/**
 * The name this account's recovery manifest is stored under inside a quilt (NCF-3 §2.5).
 *
 * Public, and deliberately not secret-looking: it is a v4-shaped UUID exactly like the random
 * per-item identifiers beside it in the same quilt. What it buys is that a recovery holding only
 * an account code can compute the one name to ask a public aggregator for — no NMTS server, no
 * saved file, no prior knowledge of the account's data.
 *
 * Takes `dataKey` rather than the account code because that key already lives in the worker; the
 * code does not, and moving it here to hash it would put it somewhere it has no reason to be.
 */
export function recovery_patch_name(data_key: Uint8Array): string;

/**
 * SHA-256 using the same `sha2` implementation as the Rust engine.
 */
export function sha256(data: Uint8Array): Uint8Array;

/**
 * The display form of a share address (`kdf_derive` bytes 208..224):
 * `XXXXXXXXX-XXXXXXXXX-XXXXXXXXC` — Crockford Base32 with a trailing check symbol.
 */
export function share_address_display(share_address: Uint8Array): string;

/**
 * The 16-byte share ADDRESS a published identity fingerprints to (NCF-3 §5.2).
 *
 * ⚠ **It parses the whole bundle first**, which means an identity whose self-signature does not
 * verify, whose version is unknown, or whose X25519 halves are degenerate has no address at all
 * as far as this function is concerned — it throws instead of returning one. Returning an address
 * for a bundle nothing vouches for would be handing the caller a value that looks checkable and
 * is not.
 *
 * Exposed so the browser can show a sender WHY a share was refused: the address it looked up and
 * the address the returned identity actually belongs to are different values, and saying so is
 * more useful than "failed".
 */
export function share_address_of(recipient_public: Uint8Array): Uint8Array;

/**
 * Parses a user-entered share address (any spacing/case) back to its 16 bytes, verifying the
 * check symbol. A typo fails HERE, in the browser, before any lookup reaches the server.
 */
export function share_address_parse(input: string): Uint8Array;

/**
 * The sender address an envelope CLAIMS, so the caller knows whose identity to fetch.
 *
 * ⚠ A claim, not a fact, until `share_unwrap_dek` succeeds — the address is bound into the
 * wrapping key, so an envelope that opens is one whose claim was true.
 */
export function share_claimed_sender(envelope: Uint8Array): Uint8Array;

/**
 * The 4989-byte PUBLIC share identity, built from the three secrets at `kdf_derive` bytes
 * 112..176 and 224..256 (KEM seed, auth secret, signing seed).
 *
 * Layout: `version(1) || derivation_index(4) || pk_sig(1312) || key_epoch(4) || pk_kem(1216) ||
 * pk_auth(32) || self_sig(2420)`. This is the only part of the identity the server holds, the
 * address is the fingerprint of its ROOT, and the self-signature is what makes every key after
 * the root attributable to that address (NCF-3 §5.2a).
 *
 * ⚠ The bytes are the same on every device the account code is entered on — deterministic
 * signing, never hedged — which is what lets the server hold one bundle per account
 * first-writer-wins without rejecting the account's own second device.
 */
export function share_public_key(share_kem_seed: Uint8Array, share_auth_secret: Uint8Array, share_sig_seed: Uint8Array): Uint8Array;

/**
 * Unwraps a share envelope addressed to us, returning the 32-byte file DEK.
 *
 * An envelope meant for somebody else fails exactly like a tampered one — the recipient's key is
 * bound into the wrapping key, so there is nothing to tell the two cases apart. Since NCF-3 §5.3
 * the same is true of an envelope stored beside a substituted name, digest or item id: the row is
 * bound in too, and a rewritten row is indistinguishable from a forged envelope.
 */
export function share_unwrap_dek(share_kem_seed: Uint8Array, share_auth_secret: Uint8Array, share_sig_seed: Uint8Array, sender_public: Uint8Array, envelope: Uint8Array, item_id: string, name_share_ct: Uint8Array, content_hash_share_ct: Uint8Array): Uint8Array;

/**
 * Wraps a file DEK for ONE recipient, given the public key the server returned AND the address
 * the sender was actually given.
 *
 * ⚠ **Both arguments are required on purpose.** The key is checked against the address before
 * anything is encrypted to it, so a server that substitutes its own key is refused here rather
 * than silently handed a readable DEK (NCF-3 §5.2, defect A1). There is deliberately no
 * two-argument form.
 *
 * ⚠ **The last three arguments are the row this envelope will be stored in** — the item id and
 * the already-sealed name and content digest — and they are required for the same kind of reason
 * (NCF-3 §5.3, defect A6). They are hashed into the wrapping key, so an envelope kept next to
 * different columns stops opening. **This therefore has to be called AFTER `share_seal_name` and
 * the re-sealed digest, not before.**
 *
 * Returns the 1240-byte share envelope (`sender_address(16) || kem_ciphertext(1120) || sealed
 * DEK(104)`). A fresh encapsulation is drawn per call, so wrapping the same DEK for the same
 * recipient twice produces unrelated bytes — the server cannot tell two shares went to the same
 * person.
 */
export function share_wrap_dek(sender_auth_secret: Uint8Array, sender_sig_seed: Uint8Array, recipient_public: Uint8Array, recipient_address: Uint8Array, dek: Uint8Array, item_id: string, name_share_ct: Uint8Array, content_hash_share_ct: Uint8Array): Uint8Array;

/**
 * Decrypts a whole NCF-3 stream under the file DEK, verifying framing/anti-tamper.
 */
export function stream_decrypt_all(dek: Uint8Array, stream: Uint8Array): Uint8Array;

/**
 * Decrypts ONE chunk for random access (ranged reads), independent of any stream state.
 *
 * `header` is the 72-byte stream header; `chunk_index` the zero-based chunk index (non-negative
 * integer); `ciphertext` must be EXACTLY that chunk's bytes — chunk `i` starts at stream
 * offset `72 + i·(chunk_size+16)` and is `chunk_plaintext_len(i) + 16` bytes. `is_final`
 * is derived from the header INSIDE Rust, so callers cannot mis-authenticate finality;
 * a wrongly sized or out-of-range slice is rejected.
 *
 * `expected_part_index` / `expected_part_total` are WHERE THE CALLER BELIEVES IT IS READING
 * (§4.1, defect A4) and are required, not optional. A ranged reader receives the header and the
 * chunk in the SAME response, so the AAD it authenticates against is self-consistent whichever
 * part the server actually served — and every part of a file is sealed under one DEK, so the
 * wrong part opens cleanly with a valid tag. A whole file in one blob is `0, 1`. Take these from
 * the position the byte range was computed FROM; reading them back out of `header` compares a
 * value with itself and restores the hole.
 */
export function stream_decrypt_chunk(dek: Uint8Array, header: Uint8Array, expected_part_index: number, expected_part_total: number, chunk_index: number, ciphertext: Uint8Array): Uint8Array;

/**
 * Encrypts `plaintext` into a whole NCF-3 stream under `dek` (production: random nonce prefix).
 */
export function stream_encrypt_all(dek: Uint8Array, plaintext: Uint8Array): Uint8Array;

/**
 * Checks that a multi-part file's headers are the complete set, in order, of one file
 * (NCF-3 §4.1, defect A4). `headers` is the parts' headers CONCATENATED in the order they
 * will be decrypted — `part_total × 72` bytes.
 *
 * ⚠ Order is the whole point: the check is "the i-th header says part i", not "every index
 * appears once". Sorting the parts by their own claimed index before calling this would make
 * it pass on any permutation, which is exactly the attack it exists to catch. Pass them in
 * the order the download will actually consume, straight from the server's list.
 */
export function verify_part_set(headers: Uint8Array): void;

/**
 * `SHA-256(normalize(input))` — the voucher redemption hash for arbitrary user input.
 */
export function voucher_hash_from_input(input: string): Uint8Array;

/**
 * Derives the Ed25519 seed for wallet number `index` from the 32-byte `wallet_root`.
 *
 * EVERY wallet comes from here, including wallet 0. NCF-2 gave the first wallet its own
 * derivation off the account PRK because it already existed on chain and could not move; NCF-3
 * deletes that exception, so there is one rule and no index this function refuses.
 */
export function wallet_seed_for(wallet_root: Uint8Array, index: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_sha256hasher_free: (a: number, b: number) => void;
    readonly __wbg_streamdecryptor_free: (a: number, b: number) => void;
    readonly __wbg_streamencryptor_free: (a: number, b: number) => void;
    readonly account_code_display: (a: number, b: number) => [number, number, number, number];
    readonly account_code_generate: () => [number, number];
    readonly account_code_parse: (a: number, b: number) => [number, number, number, number];
    readonly b64_encode: (a: number, b: number) => [number, number];
    readonly device_wrap_key: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly envelope_open: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly envelope_seal: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly generate_dek: () => [number, number];
    readonly header_chunk_count: (a: number, b: number) => [number, number, number];
    readonly header_chunk_size: (a: number, b: number) => [number, number, number];
    readonly header_part_index: (a: number, b: number) => [number, number, number];
    readonly header_part_total: (a: number, b: number) => [number, number, number];
    readonly header_plaintext_len: (a: number, b: number) => [number, number, number];
    readonly kdf_derive: (a: number, b: number) => [number, number, number, number];
    readonly recovery_patch_name: (a: number, b: number) => [number, number, number, number];
    readonly sha256: (a: number, b: number) => [number, number];
    readonly sha256hasher_finalize: (a: number) => [number, number, number, number];
    readonly sha256hasher_new: () => number;
    readonly sha256hasher_update: (a: number, b: number, c: number) => [number, number];
    readonly share_address_display: (a: number, b: number) => [number, number, number, number];
    readonly share_address_of: (a: number, b: number) => [number, number, number, number];
    readonly share_address_parse: (a: number, b: number) => [number, number, number, number];
    readonly share_claimed_sender: (a: number, b: number) => [number, number, number, number];
    readonly share_public_key: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly share_unwrap_dek: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => [number, number, number, number];
    readonly share_wrap_dek: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => [number, number, number, number];
    readonly stream_decrypt_all: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly stream_decrypt_chunk: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number, number];
    readonly stream_encrypt_all: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly streamdecryptor_finish: (a: number) => [number, number];
    readonly streamdecryptor_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly streamdecryptor_push: (a: number, b: number, c: number) => [number, number, number, number];
    readonly streamencryptor_chunk_count: (a: number) => number;
    readonly streamencryptor_finish: (a: number) => [number, number, number, number];
    readonly streamencryptor_header: (a: number) => [number, number];
    readonly streamencryptor_new: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly streamencryptor_push: (a: number, b: number, c: number) => [number, number, number, number];
    readonly streamencryptor_resumeFromHeader: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly verify_part_set: (a: number, b: number) => [number, number];
    readonly voucher_hash_from_input: (a: number, b: number) => [number, number];
    readonly wallet_seed_for: (a: number, b: number, c: number) => [number, number, number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
