// Writing VERSION 1 of an account's sealed file list — the only write that builds on nothing.
//
// ⛔ IT IS A SEPARATE DOOR FROM EVERY OTHER WRITE, AND THAT IS THE POINT. Ordinary edits read the
//    current list, apply an intent to it and hand the server the version they built on; there is
//    no version to build on here, so this one declares `base_seq: null` — "I believe this account
//    has no list". The server accepts that only while none exists. So the guarantee "a rebuild
//    never overwrites a list" is not a check this file performs and could forget: it is the shape
//    of the request. A list that appeared while this ran comes back as a version conflict, and a
//    conflict here is a REFUSAL rather than something to retry — retrying would mean rebuilding on
//    top of somebody's real names.
//
// ⛔ AND THE CALLER MUST STILL LOOK FIRST. The server's refusal is the last line, not the first:
//    reading the list before building one is what lets this tool say "this account already has a
//    file list" without spending a listing of the whole account first.
import { request, ServerError } from "./api.js";
import { AAD, DERIVED, loadCrypto } from "./crypto.js";
import { NmtsError } from "./errors.js";
import { recordWrittenList } from "./manifest.js";
import { encodeManifest } from "./shared/lib/drive/manifest-codec.js";
/**
 * Seal these entries as version 1 and write them, or refuse because a list already exists.
 *
 * ⛔ NO `prev` LINK, because there is nothing before this. Version 1 is the one version that is
 *    allowed not to name what it continued from; every version after it must, or the fork check
 *    has a hole exactly where a fork would be introduced.
 *
 * ⛔ NO SETTINGS EITHER. Account settings live in this blob or nowhere, and a rebuild has none to
 *    carry: they were in the list that was lost. Writing an empty set is not a loss caused here.
 */
export async function createFirstList(input, entries) {
    const crypt = await loadCrypto();
    const [from, to] = DERIVED.fileListKey;
    const derived = crypt.kdf_derive(crypt.account_code_parse(input.code));
    const key = derived.slice(from, to);
    derived.fill(0);
    try {
        const body = await encodeManifest(entries, 1);
        const sealed = crypt.envelope_seal(key, new TextEncoder().encode(AAD.fileList), body);
        body.fill(0);
        const ct = Buffer.from(sealed).toString("base64url");
        let answer;
        try {
            answer = await request(input.server, "/v1/manifest", {
                method: "PUT",
                token: input.apiKey,
                // ⛔ `null` IS THE WHOLE SAFETY DEVICE. Any number here would mean "replace the version I
                //    read", which is exactly what a rebuild must never do.
                body: { base_seq: null, ct },
            });
        }
        catch (error) {
            if (error instanceof ServerError && error.code === "VERSION_CONFLICT") {
                throw new NmtsError("This account already has a file list, so nothing was rebuilt.", {
                    exitCode: 4,
                    nextStep: "Nothing was changed. A list appeared while this ran — another device wrote one, or " +
                        "one was there all along. Run `nmts ls` to see what it holds; a rebuild would have " +
                        "replaced its names with placeholders.",
                });
            }
            throw error;
        }
        const seq = seqOf(answer);
        // ⛔ ONLY NOW. Recording a version the server did not accept would leave this machine believing
        //    in a list that never existed, and then refusing the real one as a rollback.
        await recordWrittenList(input.accountId, seq, ct);
        return { seq };
    }
    finally {
        key.fill(0);
    }
}
function seqOf(answer) {
    if (typeof answer === "object" && answer !== null) {
        const seq = Reflect.get(answer, "seq");
        if (typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 1)
            return seq;
    }
    throw new NmtsError("The file list was written but the server did not say which version it is now.", {
        nextStep: "The list is saved. Run `nmts ls` to see it.",
    });
}
