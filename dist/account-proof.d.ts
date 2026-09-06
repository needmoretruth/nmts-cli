import type { CredentialSource } from "./credentials.ts";
/**
 * The proof value for one account code, base64url of 32 bytes.
 *
 * ⛔ NO POLICY HERE. Whether this run may build one is decided by `accountProofFor` below; keeping
 *    the arithmetic separate from the permission is what lets a test drive each without the other.
 */
export declare function accountProof(code: string): Promise<string>;
/** A run's account code together with where this machine got it from. */
export interface CodeInHand {
    code: string;
    source: CredentialSource;
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
export declare function accountProofFor(held: CodeInHand): Promise<string>;
