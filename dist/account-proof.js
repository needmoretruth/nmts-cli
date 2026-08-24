// Proving possession of the account code to a server that already trusts this machine's API key.
//
// ⛔ WHY A SECOND PROOF EXISTS AT ALL. Three routes rebuild an account's disaster-recovery
//    artefacts — the dump every recovery list is assembled from, and the two records that say a
//    list was written. The owner decided a key alone is not enough to reach them: the code is
//    re-entered. So the server's verdict on those three is `NeedsAccountProof`, and a request that
//    carries only a key is refused with ACCOUNT_PROOF_REQUIRED however perfect the key is.
//
// ⛔ WHAT THE VALUE IS, AND WHY SENDING IT IS SAFE. It is `authSecret` — bytes [16,48) of the
//    derivation (NCF-3 §1), the SAME 32 bytes every sign-in sends, over TLS, for the server to
//    check against the argon2id verifier it stores. It is not the account code and it decrypts
//    nothing: `dataKey`, the file keys, the file-list key and the wallet root are different slices
//    of the same output and none of them reach this or any other request. Deriving it is one-way,
//    so a server that holds it cannot work back to the code.
//
// ⛔ WHAT IT CAN STILL DO IF IT IS STOLEN, said plainly rather than implied. It proves the code at
//    every door that asks for the code — which today means issuing API keys, revoking them, and
//    ERASING THE ACCOUNT. Whoever holds it cannot read one byte of a file, and can still destroy
//    every one of them. That is why it is built for one request and never written down: this
//    module returns a string, no caller stores it, and `api.ts` puts it in one header and nowhere
//    else — not a URL, not a message, not a log line.
//
// ⛔ THE ACCOUNT CODE ITSELF STAYS HERE. It is not an argument to anything, it is not in the
//    header, and the buffers the derivation produces are wiped on every path out — including the
//    failing one. The derivation output is not an account id: it is every key in the account.
import { requireConsent } from "./consent.js";
import { DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
/**
 * The proof value for one account code, base64url of 32 bytes.
 *
 * ⛔ NO POLICY HERE. Whether this run may build one is decided by `accountProofFor` below; keeping
 *    the arithmetic separate from the permission is what lets a test drive each without the other.
 */
export async function accountProof(code) {
    const glue = await loadCrypto();
    let bytes;
    try {
        bytes = glue.account_code_parse(code);
    }
    catch {
        // ⛔ The engine's own message is not repeated: it can contain the input.
        throw new NmtsError("That is not a valid NMTS account code.", {
            exitCode: 2,
            nextStep: "Check for a mistyped or missing character. The last character is a check symbol.",
        });
    }
    const derived = glue.kdf_derive(bytes);
    try {
        const [from, to] = DERIVED.authSecret;
        // `Buffer.from` copies, so the wipe below reaches the only live copy of the other keys.
        return Buffer.from(derived.subarray(from, to)).toString("base64url");
    }
    finally {
        derived.fill(0);
        bytes.fill(0);
    }
}
/**
 * The proof for this run — asked for, never assumed.
 *
 * ⛔ THE AGREEMENT IS `plain-env`, AND IT IS THE ONE THAT ALREADY COVERS THIS. Its words are
 *    exactly "use the account code from a plain environment variable", which is what a run does
 *    when it turns `NMTS_ACCOUNT_CODE` into a value it sends. A sixth consent key is not the
 *    answer: `consent.ts` says in its header why the count is five and that adding to it is a
 *    decision rather than a tidy-up, and the bar it sets — undoable, costly, or the code somewhere
 *    that is not this tool's sealed file — is met by the existing key rather than by a new one.
 *
 * ⛔ ASKED HERE AND NOT ONLY WHERE THE CODE WAS READ. `code-access.ts` does require it when it
 *    reads that variable, and its own header says why a rule enforced at each call site has as
 *    many holes as there are call sites. This is the call site that SENDS something, so it asks
 *    for itself; an already-granted agreement costs a file read and no question.
 */
export async function accountProofFor(held) {
    if (held.source === "env")
        requireConsent("plain-env");
    return await accountProof(held.code);
}
