// The frozen tables of NCF-3, and the one door to the engine that reads them.
//
// ⛔ NOTHING IS RE-IMPLEMENTED HERE. The bytes that derive an account's keys are the same
//    WebAssembly the browser runs, built from the same Rust crate. Two harnesses in this repo
//    already load it exactly this way and a gate refuses green if their assertion count drops, so
//    this path is held by a machine and not by memory. A TypeScript re-derivation of NCF-3 would
//    be a second implementation that can drift from the first, silently and in the direction that
//    loses files.
//
// ⛔ WHERE THE ENGINE COMES FROM IS THE HOST'S BUSINESS, not this file's. Node finds it on disk
//    and a browser fetches it, and both answers land in `host().engine` — so the tables below, and
//    every module that derives anything from them, are the same code in both. The shape check
//    stays on the host's side of the door for the same reason: `crypto-surface.ts` is one gate
//    that both loads pass, rather than two guards that can come to disagree.
import { host } from "./host.js";
/**
 * The associated-data strings of NCF-3, for the envelopes this tool opens.
 *
 * ⛔ FROZEN (NCF-3 §2.2). They are the separator between one purpose and another: the file list
 *    cannot be opened as a delegation, and neither can be opened as a file. Copied here rather
 *    than imported because this package does not import the browser tree — the conformance
 *    vectors are what arbitrate, and they are in the crypto repository.
 */
export const AAD = {
    fileList: "nmts/v3/file-list",
    // ⚠ THE CHUNK LABEL IS NOT SPELLED HERE. One CHUNK of the chunked file list is sealed under
    //   `nmts/v3/file-list-chunk` (NCF-3 §6.3.2), and that string is declared in the shared copy of
    //   the chunk codec as `AAD_FILE_LIST_CHUNK` and used from there. A second spelling in this
    //   table is exactly how the two halves of the product would come to disagree about a separator
    //   whose whole job is that a chunk can never be presented as an index.
    /** Wraps a file's own key under the account's data key (NCF-3 §3). */
    dekWrap: "nmts/v3/dek-wrap",
    /**
     * Wraps the SHA-256 of a file's whole plaintext (NCF-3 §2.2).
     *
     * Sealed rather than stored bare because a plaintext content hash identifies the FILE: it is
     * matchable against public hash sets, and it is equal across two accounts holding the same file.
     */
    contentHash: "nmts/v3/content-hash",
    /**
     * Seals a shared file's name and size FOR THE RECIPIENT, under the file's own key (NCF-3 §5.4).
     *
     * ⚠ A different separator from the account's own file list on purpose: the recipient holds the
     *   file key and nothing else, so the name has to travel under that key rather than under an
     *   account data key they do not have.
     */
    shareName: "nmts/v3/share-name",
    /** Seals the shared file's plaintext digest for the recipient, under the same file key. */
    shareContentHash: "nmts/v3/share-content-hash",
    /** Seals the RECOVERY LIST — where every file's bytes are (NRM §1). ⛔ The old spelling of the
     *  artefact's name is frozen INTO the separator: every list ever sealed is bound to these bytes. */
    recoveryMap: "nmts/v3/recovery-map",
};
/**
 * Byte ranges inside `kdf_derive`'s output.
 *
 * ⛔ These are a CONTRACT WITH A FROZEN FORMAT (NCF-3 §1), not a convenience. They are written
 *    here as ranges rather than magic numbers at call sites so a reader can check them against the
 *    format document in one place — and so a future version bump changes one table.
 */
export const DERIVED = {
    accountId: [0, 16],
    authSecret: [16, 48],
    dataKey: [48, 80],
    fileListKey: [80, 112],
    /**
     * The three secrets behind this account's sharing identity (NCF-3 §5.1).
     *
     * ⚠ `shareSigSeed` SITS AT THE TAIL, not beside the other two, and that is not tidiness lost —
     *   it was appended on 2026-08-02 because filing it in the obvious place would have shifted
     *   `walletRoot` and `shareAddress`, which are frozen. `web/src/lib/crypto/kdf-offsets.ts`
     *   carries the same table for the browser.
     */
    shareKemSeed: [112, 144],
    shareAuthSecret: [144, 176],
    /**
     * The root every one of this account's wallets is derived from.
     *
     * ⚠ IT IS AN HKDF PRK, NOT KEY MATERIAL TO EXTRACT AGAIN. `wallet_seed_for` expands from it
     *   directly; a re-implementation that ran a second Extract over these bytes would produce
     *   plausible-looking seeds for a different set of addresses.
     */
    walletRoot: [176, 208],
    shareAddress: [208, 224],
    shareSigSeed: [224, 256],
    /**
     * The root every one of this account's AI-account NMTS KEYS is expanded from (NCF-3 §1.5).
     *
     * ⚠ Appended at the TAIL on 2026-09-06, for the reason `shareSigSeed` was: filing it anywhere
     *   else would have shifted frozen offsets. Like `walletRoot` it is an HKDF PRK, expanded from
     *   directly — and what it expands to is 20 bytes that ARE an NMTS key, not a seed.
     */
    aiAccountRoot: [256, 288],
};
/**
 * The engine, loaded once by whichever host this program registered.
 *
 * Every derivation in the package goes through this one call, so a program that has not registered
 * a host is told so here rather than somewhere deeper, where the message would be about a missing
 * function instead of a missing entry point.
 */
export async function loadCrypto() {
    return host().engine.load();
}
