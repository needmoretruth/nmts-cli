/* @ts-self-types="./nmts_crypto_wasm.d.ts" */

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        Sha256HasherFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sha256hasher_free(ptr, 0);
    }
    /**
     * The 32-byte digest. Consumes the state — calling twice errors rather than returning
     * the digest of a silently restarted hasher.
     * @returns {Uint8Array}
     */
    finalize() {
        const ret = wasm.sha256hasher_finalize(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * A fresh hasher with empty state.
     */
    constructor() {
        const ret = wasm.sha256hasher_new();
        this.__wbg_ptr = ret;
        Sha256HasherFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Absorb the next plaintext slice, in order. Any slice size.
     * @param {Uint8Array} data
     */
    update(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sha256hasher_update(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) Sha256Hasher.prototype[Symbol.dispose] = Sha256Hasher.prototype.free;

/**
 * Streaming sequential NCF-3 decryptor with full anti-truncation/reorder verification
 * (the download path). Construct with the file DEK and the 72-byte stream header,
 * `push()` ciphertext in arbitrary slice sizes — each call returns decrypted plaintext
 * for any chunks that completed — then call `finish()` after the last byte: it enforces
 * every end-of-stream invariant (all chunks consumed, final chunk flagged, decoded total
 * equals `plaintext_len`, no trailing bytes). Call `free()` afterwards.
 */
export class StreamDecryptor {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StreamDecryptorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_streamdecryptor_free(ptr, 0);
    }
    /**
     * Verifies the stream ended cleanly (end-of-stream invariants above). Errors on an
     * incomplete or oversized stream; idempotent after a successful call (mirrors Rust).
     */
    finish() {
        const ret = wasm.streamdecryptor_finish(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * `dek` must be 32 bytes; `header` the 72-byte NCF-3 stream header (parsed and
     * validated here — bad magic/version/chunk size error immediately).
     * @param {Uint8Array} dek
     * @param {Uint8Array} header
     */
    constructor(dek, header) {
        const ptr0 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.streamdecryptor_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        StreamDecryptorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Feeds ciphertext in. Returns decrypted plaintext for any chunks that completed
     * (possibly empty). Tampering, reordering, and truncation surface as errors here.
     * @param {Uint8Array} data
     * @returns {Uint8Array}
     */
    push(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.streamdecryptor_push(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
}
if (Symbol.dispose) StreamDecryptor.prototype[Symbol.dispose] = StreamDecryptor.prototype.free;

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
    static __wrap(ptr) {
        const obj = Object.create(StreamEncryptor.prototype);
        obj.__wbg_ptr = ptr;
        StreamEncryptorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StreamEncryptorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_streamencryptor_free(ptr, 0);
    }
    /**
     * Total chunk count for this stream: `max(1, ceil(plaintext_len / chunk_size))`.
     * @returns {number}
     */
    chunk_count() {
        const ret = wasm.streamencryptor_chunk_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Flushes any buffered chunks plus the final chunk (sealed with `is_final = 0x01`).
     * Errors if fewer than `plaintext_len` bytes were pushed. A second call returns an
     * empty array (idempotent — mirrors the Rust engine's `finish`).
     * @returns {Uint8Array}
     */
    finish() {
        const ret = wasm.streamencryptor_finish(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The 32 plaintext header bytes (magic/version/log2/plaintext_len/nonce_prefix).
     * Emit these first, before any chunk output. On a resume handle these are the SAME
     * bytes passed to `resumeFromHeader`.
     * @returns {Uint8Array}
     */
    header() {
        const ret = wasm.streamencryptor_header(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
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
     * @param {Uint8Array} dek
     * @param {number} plaintext_len
     * @param {number} part_index
     * @param {number} part_total
     */
    constructor(dek, plaintext_len, part_index, part_total) {
        const ptr0 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.streamencryptor_new(ptr0, len0, plaintext_len, part_index, part_total);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        StreamEncryptorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Feeds plaintext in. Returns the sealed bytes (`ciphertext||tag` each) of any chunks
     * that became complete — possibly empty. Errors if more than `plaintext_len` bytes
     * are pushed in total.
     * @param {Uint8Array} data
     * @returns {Uint8Array}
     */
    push(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.streamencryptor_push(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
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
     * @param {Uint8Array} dek
     * @param {Uint8Array} header
     * @returns {StreamEncryptor}
     */
    static resumeFromHeader(dek, header) {
        const ptr0 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.streamencryptor_resumeFromHeader(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return StreamEncryptor.__wrap(ret[0]);
    }
}
if (Symbol.dispose) StreamEncryptor.prototype[Symbol.dispose] = StreamEncryptor.prototype.free;

/**
 * The display string for a set of 20 raw account-code bytes.
 * @param {Uint8Array} code_bytes
 * @returns {string}
 */
export function account_code_display(code_bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(code_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.account_code_display(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Generates a fresh 160-bit account code and returns its display string
 * (`XXXX-XXXX-…-XXXXC`). The bytes never leave the worker except as this one-time string.
 * @returns {string}
 */
export function account_code_generate() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.account_code_generate();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Parses+validates a user-entered account code (any spacing/case), returning the 20 raw
 * bytes. Errors if the check symbol fails.
 * @param {string} input
 * @returns {Uint8Array}
 */
export function account_code_parse(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.account_code_parse(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Unpadded base64url of arbitrary bytes. The textual `accountId` is
 * `b64_encode(account_id_16_bytes)`.
 * @param {Uint8Array} data
 * @returns {string}
 */
export function b64_encode(data) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.b64_encode(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

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
 * @param {Uint8Array} passphrase
 * @param {Uint8Array} salt
 * @returns {Uint8Array}
 */
export function device_wrap_key(passphrase, salt) {
    const ptr0 = passArray8ToWasm0(passphrase, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(salt, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.device_wrap_key(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Decrypts and authenticates an envelope (`nonce||ct||tag`) under `key`, checking `aad`.
 * @param {Uint8Array} key
 * @param {Uint8Array} aad
 * @param {Uint8Array} envelope
 * @returns {Uint8Array}
 */
export function envelope_open(key, aad, envelope) {
    const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(aad, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(envelope, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.envelope_open(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Encrypts `plaintext` under `key` with a FRESH random 24-byte nonce (production path).
 * @param {Uint8Array} key
 * @param {Uint8Array} aad
 * @param {Uint8Array} plaintext
 * @returns {Uint8Array}
 */
export function envelope_seal(key, aad, plaintext) {
    const ptr0 = passArray8ToWasm0(key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(aad, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.envelope_seal(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * A fresh random 32-byte file DEK (WebCrypto-backed).
 * @returns {Uint8Array}
 */
export function generate_dek() {
    const ret = wasm.generate_dek();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Chunk count derived from a validated header: `max(1, ceil(plaintext_len/chunk_size))`.
 * Errors on a malformed header or a count beyond 2^53.
 * @param {Uint8Array} header
 * @returns {number}
 */
export function header_chunk_count(header) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.header_chunk_count(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * Chunk size in bytes from a validated header (`1 << chunk_size_log2`; 4 MiB in v1).
 * Errors on a malformed header. Always a power of two, hence exact as a JS number.
 * @param {Uint8Array} header
 * @returns {number}
 */
export function header_chunk_size(header) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.header_chunk_size(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * Where this part sits in its file, and how many parts the file has (NCF-3 §4.1).
 * Exposed so the download path can show and check placement without decrypting anything.
 * @param {Uint8Array} header
 * @returns {number}
 */
export function header_part_index(header) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.header_part_index(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * @param {Uint8Array} header
 * @returns {number}
 */
export function header_part_total(header) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.header_part_total(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * `plaintext_len` from a validated 32-byte header (u64 LE at offset 8). Errors on a
 * malformed header, or on a declared length beyond 2^53 (not a JS-safe integer).
 * @param {Uint8Array} header
 * @returns {number}
 */
export function header_plaintext_len(header) {
    const ptr0 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.header_plaintext_len(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

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
 * @param {Uint8Array} code_bytes
 * @returns {Uint8Array}
 */
export function kdf_derive(code_bytes) {
    const ptr0 = passArray8ToWasm0(code_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kdf_derive(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

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
 * @param {Uint8Array} data_key
 * @returns {string}
 */
export function recovery_patch_name(data_key) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(data_key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.recovery_patch_name(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * SHA-256 using the same `sha2` implementation as the Rust engine.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function sha256(data) {
    const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.sha256(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The display form of a share address (`kdf_derive` bytes 208..224):
 * `XXXXXXXXX-XXXXXXXXX-XXXXXXXXC` — Crockford Base32 with a trailing check symbol.
 * @param {Uint8Array} share_address
 * @returns {string}
 */
export function share_address_display(share_address) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(share_address, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.share_address_display(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

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
 * @param {Uint8Array} recipient_public
 * @returns {Uint8Array}
 */
export function share_address_of(recipient_public) {
    const ptr0 = passArray8ToWasm0(recipient_public, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.share_address_of(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Parses a user-entered share address (any spacing/case) back to its 16 bytes, verifying the
 * check symbol. A typo fails HERE, in the browser, before any lookup reaches the server.
 * @param {string} input
 * @returns {Uint8Array}
 */
export function share_address_parse(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.share_address_parse(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The sender address an envelope CLAIMS, so the caller knows whose identity to fetch.
 *
 * ⚠ A claim, not a fact, until `share_unwrap_dek` succeeds — the address is bound into the
 * wrapping key, so an envelope that opens is one whose claim was true.
 * @param {Uint8Array} envelope
 * @returns {Uint8Array}
 */
export function share_claimed_sender(envelope) {
    const ptr0 = passArray8ToWasm0(envelope, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.share_claimed_sender(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

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
 * @param {Uint8Array} share_kem_seed
 * @param {Uint8Array} share_auth_secret
 * @param {Uint8Array} share_sig_seed
 * @returns {Uint8Array}
 */
export function share_public_key(share_kem_seed, share_auth_secret, share_sig_seed) {
    const ptr0 = passArray8ToWasm0(share_kem_seed, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(share_auth_secret, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(share_sig_seed, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.share_public_key(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Unwraps a share envelope addressed to us, returning the 32-byte file DEK.
 *
 * An envelope meant for somebody else fails exactly like a tampered one — the recipient's key is
 * bound into the wrapping key, so there is nothing to tell the two cases apart. Since NCF-3 §5.3
 * the same is true of an envelope stored beside a substituted name, digest or item id: the row is
 * bound in too, and a rewritten row is indistinguishable from a forged envelope.
 * @param {Uint8Array} share_kem_seed
 * @param {Uint8Array} share_auth_secret
 * @param {Uint8Array} share_sig_seed
 * @param {Uint8Array} sender_public
 * @param {Uint8Array} envelope
 * @param {string} item_id
 * @param {Uint8Array} name_share_ct
 * @param {Uint8Array} content_hash_share_ct
 * @returns {Uint8Array}
 */
export function share_unwrap_dek(share_kem_seed, share_auth_secret, share_sig_seed, sender_public, envelope, item_id, name_share_ct, content_hash_share_ct) {
    const ptr0 = passArray8ToWasm0(share_kem_seed, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(share_auth_secret, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(share_sig_seed, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(sender_public, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(envelope, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passStringToWasm0(item_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passArray8ToWasm0(name_share_ct, wasm.__wbindgen_malloc);
    const len6 = WASM_VECTOR_LEN;
    const ptr7 = passArray8ToWasm0(content_hash_share_ct, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ret = wasm.share_unwrap_dek(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v9 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v9;
}

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
 * @param {Uint8Array} sender_auth_secret
 * @param {Uint8Array} sender_sig_seed
 * @param {Uint8Array} recipient_public
 * @param {Uint8Array} recipient_address
 * @param {Uint8Array} dek
 * @param {string} item_id
 * @param {Uint8Array} name_share_ct
 * @param {Uint8Array} content_hash_share_ct
 * @returns {Uint8Array}
 */
export function share_wrap_dek(sender_auth_secret, sender_sig_seed, recipient_public, recipient_address, dek, item_id, name_share_ct, content_hash_share_ct) {
    const ptr0 = passArray8ToWasm0(sender_auth_secret, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(sender_sig_seed, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(recipient_public, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(recipient_address, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passStringToWasm0(item_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passArray8ToWasm0(name_share_ct, wasm.__wbindgen_malloc);
    const len6 = WASM_VECTOR_LEN;
    const ptr7 = passArray8ToWasm0(content_hash_share_ct, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ret = wasm.share_wrap_dek(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v9 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v9;
}

/**
 * Decrypts a whole NCF-3 stream under the file DEK, verifying framing/anti-tamper.
 * @param {Uint8Array} dek
 * @param {Uint8Array} stream
 * @returns {Uint8Array}
 */
export function stream_decrypt_all(dek, stream) {
    const ptr0 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(stream, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.stream_decrypt_all(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

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
 * @param {Uint8Array} dek
 * @param {Uint8Array} header
 * @param {number} expected_part_index
 * @param {number} expected_part_total
 * @param {number} chunk_index
 * @param {Uint8Array} ciphertext
 * @returns {Uint8Array}
 */
export function stream_decrypt_chunk(dek, header, expected_part_index, expected_part_total, chunk_index, ciphertext) {
    const ptr0 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(header, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.stream_decrypt_chunk(ptr0, len0, ptr1, len1, expected_part_index, expected_part_total, chunk_index, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Encrypts `plaintext` into a whole NCF-3 stream under `dek` (production: random nonce prefix).
 * @param {Uint8Array} dek
 * @param {Uint8Array} plaintext
 * @returns {Uint8Array}
 */
export function stream_encrypt_all(dek, plaintext) {
    const ptr0 = passArray8ToWasm0(dek, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(plaintext, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.stream_encrypt_all(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Checks that a multi-part file's headers are the complete set, in order, of one file
 * (NCF-3 §4.1, defect A4). `headers` is the parts' headers CONCATENATED in the order they
 * will be decrypted — `part_total × 72` bytes.
 *
 * ⚠ Order is the whole point: the check is "the i-th header says part i", not "every index
 * appears once". Sorting the parts by their own claimed index before calling this would make
 * it pass on any permutation, which is exactly the attack it exists to catch. Pass them in
 * the order the download will actually consume, straight from the server's list.
 * @param {Uint8Array} headers
 */
export function verify_part_set(headers) {
    const ptr0 = passArray8ToWasm0(headers, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.verify_part_set(ptr0, len0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * `SHA-256(normalize(input))` — the voucher redemption hash for arbitrary user input.
 * @param {string} input
 * @returns {Uint8Array}
 */
export function voucher_hash_from_input(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.voucher_hash_from_input(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Derives the Ed25519 seed for wallet number `index` from the 32-byte `wallet_root`.
 *
 * EVERY wallet comes from here, including wallet 0. NCF-2 gave the first wallet its own
 * derivation off the account PRK because it already existed on chain and could not move; NCF-3
 * deletes that exception, so there is one rule and no index this function refuses.
 * @param {Uint8Array} wallet_root
 * @param {number} index
 * @returns {Uint8Array}
 */
export function wallet_seed_for(wallet_root, index) {
    const ptr0 = passArray8ToWasm0(wallet_root, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.wallet_seed_for(ptr0, len0, index);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_92b29b0548f8b746: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_is_function_1ff95bcc5517c252: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_a27215656b807791: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_ea5e6cc2e4141dfe: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_a6e5c5dce5018821: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_e6785c33c8e4cce8: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_3ed232c8a6baee09: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./nmts_crypto_wasm_bg.js": import0,
    };
}

const Sha256HasherFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sha256hasher_free(ptr, 1));
const StreamDecryptorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_streamdecryptor_free(ptr, 1));
const StreamEncryptorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_streamencryptor_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('nmts_crypto_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
