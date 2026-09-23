export interface AccountIdentity {
    /** Base64url of the 16 bytes the server knows this account by. Public. */
    accountId: string;
    /** The address other people use to share with this account. Public. */
    publicCode: string;
    /** The NMTS key as it is meant to be read, in groups. NOT printed by default. */
    displayCode: string;
}
/**
 * Check that a string is a real NMTS key — or its 15-word recovery phrase — and return the key in
 * its display form, so what gets stored is the key whichever spelling was typed.
 *
 * ⛔ This is the engine's own parser, which verifies the trailing check symbol. A typo therefore
 *    fails HERE, offline, instead of becoming a sign-in failure the person cannot tell apart from
 *    a wrong password, a network problem or a suspended account. The engine's own message is not
 *    repeated: it can contain the input.
 */
export declare function assertUsableCode(code: string): Promise<string>;
/** Derive the public facts about an account from its code. */
export declare function identityOf(code: string): Promise<AccountIdentity>;
/** The NMTS key as its 15-word recovery phrase, in `en` (default) or `ko`. */
export declare function phraseOf(code: string, lang: string | undefined): Promise<string>;
