// Making an account exist: the one derivation this tool performs that it does not keep.
//
// ⛔ WHY THIS IS NOT IN `account.ts`. That module's header says `authSecret` and `dataKey` are not
//    exposed, and it is right to say so — `identityOf` hands back only the two public values.
//    Registering a new account is the single call in this program that needs a THIRD one: the
//    server has to be given `authSecret` so it can store the argon2id verifier of it, exactly as
//    the browser does at sign-up (`web/src/lib/auth/account-service.ts`). Widening `identityOf`
//    for that would have made a promise false everywhere it is read; a separate module keeps the
//    exception in one file, next to the reason for it.
//
// ⛔ `authSecret` IS NOT THE ACCOUNT CODE AND CANNOT BE TURNED BACK INTO ONE. It is 32 bytes out
//    of a one-way derivation (NCF-3 §1.2), it opens no file, and the same value goes over the
//    wire on every sign-in the browser makes. What it can do is prove ownership, so it is built
//    here, sent once, and never written down, printed or returned to a caller that did not ask.
//
// ⛔ THE DERIVED BUFFER IS WIPED. `kdf_derive` returns EVERY key in the account — the sign-in
//    secret, the key that opens the files, the file-list key, the wallet root. Two public fields
//    are copied out and the rest is zeroed before this returns, the same discipline `identityOf`
//    keeps and for the same reason: a live copy of that buffer is a live copy of the account.
import { DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
/**
 * A brand-new account code, from the engine.
 *
 * ⛔ THE RETURNED STRING IS THE ONLY COPY THAT WILL EVER EXIST. The server keeps a verifier of a
 *    value derived from it and nothing else, so a caller that loses this has destroyed an account
 *    and nobody — not the holder, not NMTS — can bring it back. Every caller of this owes the
 *    person a way to keep it before anything else happens.
 *
 * ⛔ AND THE RANDOMNESS IS THE ENGINE'S, NEVER NODE'S — the reason `generate_dek` gives, with more
 *    at stake. These twenty bytes are the seed every key in an account descends from, so a second
 *    source of them would be a source the conformance vectors say nothing about, in the one place
 *    where a weak draw loses an entire account rather than one file. `crypto.ts` declares the
 *    engine call; this is the only thing in the program that makes it.
 */
export async function newAccountCode() {
    const glue = await loadCrypto();
    const code = glue.account_code_generate();
    if (typeof code !== "string" || code.length === 0) {
        // ⛔ Refused rather than passed on. An empty code would be registered as a real account, and
        //    the failure would surface much later as an account nobody can open.
        throw new NmtsError("The NMTS crypto engine did not produce an account code.", {
            exitCode: 1,
            nextStep: "Nothing was created. Reinstall the package and try again.",
        });
    }
    return code;
}
/**
 * The pair the server is told about a code, derived here and nowhere else.
 *
 * ⚠ It re-parses the code rather than taking bytes: the parser checks the trailing check symbol,
 *   so a code that arrived through anything but `newAccountCode` is refused before it is used to
 *   claim an account id.
 */
export async function registrationProofOf(code) {
    const glue = await loadCrypto();
    let bytes;
    try {
        bytes = glue.account_code_parse(code);
    }
    catch {
        // ⛔ The engine's own message is not repeated: it can contain the input, and the input is the
        //    account code.
        throw new NmtsError("That is not a valid NMTS account code.", {
            exitCode: 2,
            nextStep: "The last character is a check symbol, and it does not match the rest.",
        });
    }
    const derived = glue.kdf_derive(bytes);
    try {
        const [idFrom, idTo] = DERIVED.accountId;
        const [secretFrom, secretTo] = DERIVED.authSecret;
        return {
            accountId: Buffer.from(derived.slice(idFrom, idTo)).toString("base64url"),
            authSecret: Buffer.from(derived.slice(secretFrom, secretTo)).toString("base64url"),
        };
    }
    finally {
        derived.fill(0);
        bytes.fill(0);
    }
}
