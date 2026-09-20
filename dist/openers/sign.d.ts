import type { OpenerHints } from "./hints.ts";
/** What a wallet hands back: the serialized signature, and what it says it signed. */
export interface WalletSignature {
    /** The serialized signature, base64 — `flag ‖ signature ‖ public key`, as every wallet sends it. */
    signature: string;
    /** Base64 of the bytes the wallet signed, when it says. Compared, never trusted. */
    bytes?: string | undefined;
}
/** A wallet's answer in either shape: the standard's object, or the signature on its own. */
export type SignedMessage = WalletSignature | string;
/** Whatever holds the wallet's key: a browser extension, a key file, a hardware device. */
export type SignWallet = (message: Uint8Array) => Promise<SignedMessage> | SignedMessage;
/** Which account this wallet opens, and how to ask it. */
export interface WalletOpener {
    /** The wallet's Sui address, `0x` and 64 LOWERCASE hex. Refused, never repaired. */
    address: string;
    /**
     * Which of this wallet's NMTS accounts. Default 1.
     *
     * ⛔ IT IS INSIDE THE SIGNED BYTES, so nothing can look for the others: a sign-in that finds no
     *    opener cannot try 2, 3, 4 without asking the person to sign again, once per number.
     */
    account?: number | undefined;
    /**
     * A product scope. Absent means one wallet opens the same account everywhere; present means this
     * wallet opens a different account for this product alone.
     *
     * ⚠ THE PRICE OF LEAVING IT OUT: every product that gets this signature opens the same files.
     */
    app?: string | undefined;
    sign: SignWallet;
}
/** The exact bytes this wallet is asked to sign. Built by the engine; refused, never repaired. */
export declare function openerMessage(input: WalletOpener): Promise<Uint8Array>;
/**
 * Get one signature over this account's message, judge it, and lend it to `use`.
 *
 * ⛔ THE SIGNATURE IS NOT THE ANSWER. Whatever `use` returns is; the bytes are dropped when this
 *    call ends, and there is deliberately no form of this that hands them back.
 */
export declare function withSignature<T>(input: WalletOpener, use: (serialized: Uint8Array) => Promise<T>, hints?: OpenerHints): Promise<T>;
/**
 * Get the signature TWICE and refuse unless both are the same 64 bytes, then lend it to `use`.
 *
 * ⛔ THE ONE CHECK THAT MAKES AN OPENER WORTH STORING. A slot is opened by the same signature that
 *    sealed it, so a wallet that signs differently the second time seals something it can never
 *    open — and the person would learn that at their next sign-in, with the account behind it.
 *    Two signatures now is a question a wallet answers in seconds; the alternative is a slot that
 *    looks fine forever.
 *
 * ⚠ IT IS RUN FOR EVERY SCHEME, including the three that sign deterministically. An Ed25519 wallet
 *   held by a signing service, an MPC wallet or a hardware wallet with its own nonce rule all
 *   present as Ed25519 and all may hedge — the flag says how a signature is checked, not how it
 *   was made.
 */
export declare function withRepeatedSignature<T>(input: WalletOpener, use: (serialized: Uint8Array) => Promise<T>, hints?: OpenerHints): Promise<T>;
