import { type CryptoGlue } from "./crypto-surface.ts";
export type { CryptoGlue, StreamOpener, StreamSealer } from "./crypto-surface.ts";
/**
 * The associated-data strings of NCF-3, for the envelopes this tool opens.
 *
 * ⛔ FROZEN (NCF-3 §2.2). They are the separator between one purpose and another: the file list
 *    cannot be opened as a delegation, and neither can be opened as a file. Copied here rather
 *    than imported because this package does not import the browser tree — the conformance
 *    vectors are what arbitrate, and they are in the crypto repository.
 */
export declare const AAD: {
    readonly fileList: "nmts/v3/file-list";
    /** Wraps a file's own key under the account's data key (NCF-3 §3). */
    readonly dekWrap: "nmts/v3/dek-wrap";
    /**
     * Wraps the SHA-256 of a file's whole plaintext (NCF-3 §2.2).
     *
     * Sealed rather than stored bare because a plaintext content hash identifies the FILE: it is
     * matchable against public hash sets, and it is equal across two accounts holding the same file.
     */
    readonly contentHash: "nmts/v3/content-hash";
    /**
     * Seals a shared file's name and size FOR THE RECIPIENT, under the file's own key (NCF-3 §5.4).
     *
     * ⚠ A different separator from the account's own file list on purpose: the recipient holds the
     *   file key and nothing else, so the name has to travel under that key rather than under an
     *   account data key they do not have.
     */
    readonly shareName: "nmts/v3/share-name";
    /** Seals the shared file's plaintext digest for the recipient, under the same file key. */
    readonly shareContentHash: "nmts/v3/share-content-hash";
    /** Seals the RECOVERY LIST — where every file's bytes are (NRM §1). ⛔ The old spelling of the
     *  artefact's name is frozen INTO the separator: every list ever sealed is bound to these bytes. */
    readonly recoveryMap: "nmts/v3/recovery-map";
};
/**
 * Byte ranges inside `kdf_derive`'s output.
 *
 * ⛔ These are a CONTRACT WITH A FROZEN FORMAT (NCF-3 §1), not a convenience. They are written
 *    here as ranges rather than magic numbers at call sites so a reader can check them against the
 *    format document in one place — and so a future version bump changes one table.
 */
export declare const DERIVED: {
    readonly accountId: readonly [0, 16];
    readonly authSecret: readonly [16, 48];
    readonly dataKey: readonly [48, 80];
    readonly fileListKey: readonly [80, 112];
    /**
     * The three secrets behind this account's sharing identity (NCF-3 §5.1).
     *
     * ⚠ `shareSigSeed` SITS AT THE TAIL, not beside the other two, and that is not tidiness lost —
     *   it was appended on 2026-08-02 because filing it in the obvious place would have shifted
     *   `walletRoot` and `shareAddress`, which are frozen. `web/src/lib/crypto/kdf-offsets.ts`
     *   carries the same table for the browser.
     */
    readonly shareKemSeed: readonly [112, 144];
    readonly shareAuthSecret: readonly [144, 176];
    /**
     * The root every one of this account's wallets is derived from.
     *
     * ⚠ IT IS AN HKDF PRK, NOT KEY MATERIAL TO EXTRACT AGAIN. `wallet_seed_for` expands from it
     *   directly; a re-implementation that ran a second Extract over these bytes would produce
     *   plausible-looking seeds for a different set of addresses.
     */
    readonly walletRoot: readonly [176, 208];
    readonly shareAddress: readonly [208, 224];
    readonly shareSigSeed: readonly [224, 256];
    /**
     * The root every one of this account's AI-account CODES is expanded from (NCF-3 §1.5).
     *
     * ⚠ Appended at the TAIL on 2026-09-06, for the reason `shareSigSeed` was: filing it anywhere
     *   else would have shifted frozen offsets. Like `walletRoot` it is an HKDF PRK, expanded from
     *   directly — and what it expands to is 20 bytes that ARE an account code, not a seed.
     */
    readonly aiAccountRoot: readonly [256, 288];
};
export declare function engineDir(): string;
/** Load the engine once per process. */
export declare function loadCrypto(): Promise<CryptoGlue>;
/** For tests that need a fresh load. */
export declare function forgetCrypto(): void;
