/** One thing worth stopping for, and everything a person needs to decide about it. */
export interface Consent {
    /** What the tool would do. One line, in the second person. */
    what: string;
    /** What can go wrong. The reason this key exists, said plainly. */
    risk: string;
    /** What is NOT covered, said before it matters rather than after. */
    limit: string;
}
export declare const CONSENTS: {
    /**
     * Writing the NMTS key down UNSEALED — in the clear, in this tool's own file.
     *
     * ⛔ THE DEFAULT IS THE SEALED FORM, and this key is what unlocks the other one (owner,
     *    2026-08-23: support storing it, but only behind encryption unless somebody agrees to a
     *    disclaimer). It covers both the ordinary case, where mode 600 is the only protection and
     *    every program running as you can read it, and the worse one, where the filesystem cannot
     *    keep the mode either — a Windows share, some container mounts, a network drive. `login`
     *    prints which of the two this machine is before it asks.
     *
     * ⚠ IT WAS NARROWER UNTIL 2026-08-23, covering only the filesystem case. Nothing had shipped
     *   under the old meaning — the tool is not published — so no grant anywhere means less than
     *   the words above. If it ever does, this needs a new key rather than a wider one: a grant
     *   means what it said on the day it was given.
     */
    readonly "unsafe-code-storage": {
        readonly what: "Store the NMTS key in the clear, unsealed, in this tool's own file.";
        readonly risk: string;
        readonly limit: string;
    };
    /**
     * Reading the code out of a plain environment variable, or printing one to be set.
     *
     * ⛔ IT IS A DIFFERENT PLACE, NOT A SMALLER VERSION OF THE FILE (owner, 2026-08-23: an agent
     *    must be able to choose this, with the person's agreement). An environment variable leaks
     *    through channels a file does not: `docker inspect` prints the whole environment of a
     *    container, `/proc/<pid>/environ` is readable by the same user for as long as the process
     *    lives, every child process inherits it, and CI systems echo it into logs. A variable that
     *    names a FILE — `NMTS_ACCOUNT_CODE_FILE` — has none of those, which is why it needs no
     *    agreement.
     */
    readonly "plain-env": {
        readonly what: "Use the NMTS key from a plain environment variable, or print one to be set.";
        readonly risk: string;
        readonly limit: string;
    };
    /**
     * Signing a chain transaction with the wallet the NMTS key derives.
     *
     * Separate from `spend` because it is a different pot of money: credits are a promise this
     * service made, and a wallet holds assets nobody can restore.
     */
    /**
     * Handing a file to another account.
     *
     * ⛔ IT IS HERE BECAUSE THE UNDO DOES NOT UNDO IT. Every other irreversible thing in this tool
     *    costs money or moves the NMTS key; this one gives somebody else a copy of a file, and
     *    taking the share back afterwards stops future downloads and reaches nothing already
     *    fetched. That gap is not a flaw to be fixed later — it is what handing somebody a file
     *    means — so it is said before the first share rather than after it.
     */
    readonly share: {
        readonly what: "Give another account the key to one of this account's files.";
        readonly risk: string;
        readonly limit: string;
    };
    /**
     * ⛔ THIS ONE IS NOT A BARE DATE. `wallet-grant.ts` writes it with a scope, an expiry of at most
     *    30 days and optional ceilings, and `requireWalletGrant` is what asks for it — the plain
     *    `requireConsent("wallet")` would read an older bare-date record as "everything, forever".
     */
    readonly wallet: {
        readonly what: "Use the wallet this NMTS key derives, and sign transactions with it.";
        readonly risk: string;
        readonly limit: string;
    };
    /** Ending another device's session — the browser's, usually. */
    readonly "sign-out": {
        readonly what: "Sign devices out of this account from this machine.";
        readonly risk: string;
        readonly limit: "This does not touch files, credits or the wallet. It ends sessions and nothing else.";
    };
    /** Putting the previous file list back. */
    readonly rollback: {
        readonly what: "Replace the current file list with the previous one.";
        readonly risk: string;
        readonly limit: "This covers the list. It cannot restore a file whose storage has run out.";
    };
    /** Printing the NMTS key. */
    readonly reveal: {
        readonly what: "Print the NMTS key on this screen.";
        readonly risk: string;
        readonly limit: "This covers printing it. Where it goes afterwards is not something this tool can see.";
    };
    /** Writing the NMTS key into a recovery kit. */
    readonly kit: {
        readonly what: "Write the NMTS key into a recovery kit file on this disk.";
        readonly risk: string;
        readonly limit: "The recovery list alone (`recovery-list`) holds no NMTS key and asks for nothing.";
    };
    /** A gift to the developer — on its own, or as a tip at payment (2026-09-06). */
    readonly donate: {
        readonly what: "Send gifts to the developer of NMTS from this account's wallet.";
        readonly risk: string;
        readonly limit: string;
    };
    /** Destroying the treasury-owned storage under a credit-paid file. */
    readonly "release-storage": {
        readonly what: "Destroy the credit-paid storage under a file, so the network stops serving its bytes.";
        readonly risk: string;
        readonly limit: "This covers credit-paid storage only. Storage bought with your own wallet is burned by the wallet.";
    };
};
export type ConsentKey = keyof typeof CONSENTS;
/**
 * ⛔ DERIVED FROM THE TABLE, so a key added above cannot be missing from the checks below.
 *    Written as `Object.keys` of the table rather than a hand-kept array: a hand-kept one goes
 *    stale silently, and the failure is a capability nobody is ever asked about.
 */
export declare const CONSENT_KEYS: ConsentKey[];
/**
 * The whole file, as written. `wallet-grant.ts` keeps its richer record under the same key so
 * `consent` still lists one thing per key; nothing else should reach for this.
 */
export declare function readConsentRecords(): Record<string, unknown>;
export declare function writeConsentRecords(all: Record<string, unknown>): void;
/** When this key was agreed to on this machine, or null. */
export declare function grantedAt(key: ConsentKey): string | null;
export declare function isGranted(key: ConsentKey): boolean;
/** Write the grant down, with the date and the version that asked. */
export declare function grant(key: ConsentKey, version: string, now: Date): void;
export declare function revoke(key: ConsentKey): void;
/**
 * Stop unless this has been agreed to, and say exactly what agreeing would mean.
 *
 * ⛔ THE MESSAGE IS THE PRODUCT HERE. It is the only thing standing between somebody and a
 *    decision they cannot take back, so it says what happens, what can go wrong, what is not
 *    covered, and the one command that agrees — in that order, every time.
 */
export declare function requireConsent(key: ConsentKey): void;
