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
const REQUIRED = [
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
export function isCryptoGlue(value) {
    return missingExports(value).length === 0;
}
/** Which of the required functions this object does not have. Empty means it is the engine. */
export function missingExports(value) {
    if (typeof value !== "object" || value === null)
        return [...REQUIRED];
    return REQUIRED.filter((name) => {
        if (!(name in value))
            return true;
        const member = Reflect.get(value, name);
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
