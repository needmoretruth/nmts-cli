/** What `POST /v1/accounts` is told about a new account. Both values are public or one-way. */
export interface RegistrationProof {
    /** Base64url of the 16 bytes the server will know this account by. */
    accountId: string;
    /** Base64url of the 32 bytes the server stores a verifier of. Sent once; never stored here. */
    authSecret: string;
}
/**
 * A brand-new NMTS key, from the engine.
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
export declare function newAccountCode(): Promise<string>;
/**
 * The pair the server is told about a code, derived here and nowhere else.
 *
 * ⚠ It re-parses the code rather than taking bytes: the parser checks the trailing check symbol,
 *   so a code that arrived through anything but `newAccountCode` is refused before it is used to
 *   claim an account id.
 */
export declare function registrationProofOf(code: string): Promise<RegistrationProof>;
