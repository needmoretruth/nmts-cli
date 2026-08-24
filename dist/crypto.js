// Loading the real NMTS crypto engine in Node.
//
// ⛔ NOTHING IS RE-IMPLEMENTED HERE. The bytes that derive an account's keys are the same
//    WebAssembly the browser runs, built from the same Rust crate. Two harnesses in this repo
//    already load it exactly this way and a gate refuses green if their assertion count drops, so
//    this path is held by a machine and not by memory. A TypeScript re-derivation of NCF-3 would
//    be a second implementation that can drift from the first, silently and in the direction that
//    loses files.
//
// ⛔ NO TYPE ASSERTION. A dynamically imported module is `unknown` and staying honest about that
//    matters here more than anywhere: if a rebuild renamed an export, an `as` would turn that into
//    "undefined is not a function" deep inside a derivation. The guard below checks each function
//    exists before anything is derived, so a missing export is named at load time.
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NmtsError } from "./errors.js";
import { isCryptoGlue, missingExports } from "./crypto-surface.js";
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
};
export function engineDir() {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, "..", "vendor", "nmts-crypto"),
        join(here, "..", "..", "vendor", "nmts-crypto"),
        join(here, "..", "..", "web", "vendor", "nmts-crypto"),
    ];
    for (const dir of candidates) {
        if (existsSync(join(dir, "nmts_crypto_wasm_bg.wasm")))
            return dir;
    }
    throw new NmtsError("The NMTS crypto engine is missing from this installation.", {
        exitCode: 1,
        nextStep: "Reinstall the package. Nothing can be encrypted or decrypted without it.",
    });
}
let cached = null;
/** Load the engine once per process. */
export async function loadCrypto() {
    if (cached !== null)
        return cached;
    const dir = engineDir();
    const module = await import(__rewriteRelativeImportExtension(pathToFileURL(join(dir, "nmts_crypto_wasm.js")).href));
    if (typeof module !== "object" || module === null || !("default" in module)) {
        throw new NmtsError("The NMTS crypto engine did not load (no initialiser).", { exitCode: 1 });
    }
    const init = Reflect.get(module, "default");
    if (typeof init !== "function") {
        throw new NmtsError("The NMTS crypto engine did not load (initialiser is not callable).", {
            exitCode: 1,
        });
    }
    await init({ module_or_path: await readFile(join(dir, "nmts_crypto_wasm_bg.wasm")) });
    if (!isCryptoGlue(module)) {
        const missing = missingExports(module);
        throw new NmtsError(`The NMTS crypto engine is missing: ${missing.join(", ")}. This build does not match this tool.`, { exitCode: 1, nextStep: "Reinstall the package." });
    }
    cached = module;
    return module;
}
/** For tests that need a fresh load. */
export function forgetCrypto() {
    cached = null;
}
