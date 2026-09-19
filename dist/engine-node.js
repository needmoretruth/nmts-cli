// Finding and loading the engine on a machine with a disk.
//
// ⛔ NOTHING IS RE-IMPLEMENTED HERE. The bytes that derive an account's keys are the same
//    WebAssembly the browser runs, built from the same Rust crate — this file only finds the build
//    and hands it to the shape check every load passes.
//
// ⛔ SEPARATE FROM `host-node.ts` SO THAT REGISTERING A HOST COSTS NOTHING. `nmts --help` puts the
//    host in place and never derives anything; loading this file, and the four `node:` modules it
//    needs, on every run would be a fixed cost an agent pays thousands of times.
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCryptoGlue, missingExports } from "./crypto-surface.js";
import { NmtsError } from "./errors.js";
/**
 * Where the engine's WebAssembly sits, in the three places an installation can put it.
 *
 * ⛔ FOUND RATHER THAN CONFIGURED. The package carries it in `vendor/`, a checkout runs from
 *    `src/` with the same folder one level further up, and the repository's own web tree holds a
 *    build of the same crate. A path in a setting would be a fourth answer nobody keeps right.
 */
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
let engine = null;
/**
 * Load the engine once per process.
 *
 * ⛔ NO TYPE ASSERTION. A dynamically imported module is `unknown`, and staying honest about that
 *    matters here more than anywhere: a rebuild that renamed an export would otherwise become
 *    "undefined is not a function" deep inside a derivation.
 */
export async function loadEngine() {
    if (engine !== null)
        return engine;
    const dir = engineDir();
    const module = await import(__rewriteRelativeImportExtension(pathToFileURL(join(dir, "nmts_crypto_wasm.js")).href));
    if (typeof module !== "object" || module === null || !("default" in module)) {
        throw new NmtsError("The NMTS crypto engine did not load (no initialiser).", { exitCode: 1 });
    }
    const init = Reflect.get(module, "default");
    if (typeof init !== "function") {
        throw new NmtsError("The NMTS crypto engine did not load (initialiser is not callable).", { exitCode: 1 });
    }
    await init({ module_or_path: await readFile(join(dir, "nmts_crypto_wasm_bg.wasm")) });
    if (!isCryptoGlue(module)) {
        throw new NmtsError(`The NMTS crypto engine is missing: ${missingExports(module).join(", ")}. This build does not match this tool.`, { exitCode: 1, nextStep: "Reinstall the package." });
    }
    engine = module;
    return module;
}
/** For tests that need a fresh load. */
export function forgetEngine() {
    engine = null;
}
