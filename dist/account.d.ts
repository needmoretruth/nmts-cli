export interface AccountIdentity {
    /** Base64url of the 16 bytes the server knows this account by. Public. */
    accountId: string;
    /** The address other people use to share with this account. Public. */
    publicCode: string;
    /** The account code as it is meant to be read, in groups. NOT printed by default. */
    displayCode: string;
}
/**
 * Check that a string is a real account code.
 *
 * ⛔ This is the engine's own parser, which verifies the trailing check symbol. A typo therefore
 *    fails HERE, offline, instead of becoming a sign-in failure the person cannot tell apart from
 *    a wrong password, a network problem or a suspended account.
 */
export declare function assertUsableCode(code: string): Promise<void>;
/** Derive the public facts about an account from its code. */
export declare function identityOf(code: string): Promise<AccountIdentity>;
