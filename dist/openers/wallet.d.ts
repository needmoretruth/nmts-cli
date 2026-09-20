import { type OpenerAccess } from "./doors.ts";
import type { OpenerHints } from "./hints.ts";
import { type WalletOpener } from "./sign.ts";
/** What a sign-in with a wallet answers. */
export interface WalletSignIn {
    /** The NMTS key this wallet opened, in the form a person reads and types. */
    accountCode: string;
    /** The name the slot it opened is filed under — what `remove` takes. */
    locator: string;
}
/** What attaching a wallet answers. ⛔ The signature that made it is not here and cannot be. */
export interface AttachedWallet {
    locator: string;
    kind: "wallet";
}
/**
 * Sign in with a wallet: sign once, ask for the slot that name finds, and open it.
 *
 * ⛔ THERE IS NO "WRONG SIGNATURE, RIGHT SLOT" CASE. The name the slot is filed under and the key
 *    that opens it come out of the same signature, so a signature that finds a slot opens it —
 *    which is why a failure to open is reported as a defect rather than as a wrong wallet.
 *
 * ⚠ AN ACCOUNT NUMBER IS INSIDE THE SIGNED BYTES, so nothing here can look for the others. A
 *   sign-in that finds nothing says so; trying 2, 3, 4 would mean asking the person to sign once
 *   per number, and the caller is the one that may ask.
 */
export declare function signInWithWallet(server: string, input: WalletOpener, hints?: OpenerHints): Promise<WalletSignIn>;
/**
 * Attach this wallet to the account `accountCode` opens.
 *
 * ⛔ THE SIGNATURE IS TAKEN TWICE AND THE TWO MUST MATCH — see `withRepeatedSignature`. A wallet
 *    that signs differently the second time would seal a slot it could never open.
 *
 * ⛔ WHAT THIS CREATES IS A STANDING WAY INTO THE ACCOUNT. Whoever holds this wallet can open every
 *    file in it, from any machine, until the slot is removed. The server is given a locked lump it
 *    cannot open and a name it cannot trace to a wallet.
 *
 * ⛔ AND THE NAME IS ASKED FOR BEFORE ANYTHING IS SEALED OR SENT. One wallet at one account number
 *    reaches exactly one locator, so a slot already filed under it is either this account's — the
 *    wallet is attached already — or another account's, and a PUT would meet the server's flat
 *    "not found" (its deliberate answer for "not yours"). Both are said here instead, in the words
 *    that tell the person what to do about it.
 */
export declare function addWallet(access: OpenerAccess, accountCode: string, input: WalletOpener, hints?: OpenerHints): Promise<AttachedWallet>;
/**
 * Refuse NOW if this wallet, at this account number, already opens an account on this server.
 *
 * ⛔ FOR THE ONE PATH WHERE THE ACCOUNT DOES NOT EXIST YET. `nmts create --wallet` would otherwise
 *    make an account, print its key, and only then learn that the wallet cannot be attached to it —
 *    leaving behind an account nobody asked for. One signature answers that before anything is
 *    created, and there is nothing to compare the slot against, so every slot found is another
 *    account's.
 */
export declare function refuseIfWalletOpensAnAccount(server: string, input: WalletOpener, hints?: OpenerHints): Promise<void>;
/**
 * Take one wallet off the account.
 *
 * ⛔ "FROM NOW ON", NOT "AS IF IT NEVER KNEW". A wallet that opened this account once has held the
 *    NMTS key. The only answer to that is a new account, and the screen or command that offers
 *    removal is where that sentence belongs.
 */
export declare function removeWallet(access: OpenerAccess, locator: string): Promise<void>;
/**
 * The sealed 62 bytes filed under one locator — the file the recovery tool opens with a signature.
 *
 * ⛔ IT NEEDS NO CREDENTIAL AND PROVES NOTHING. Whoever has the locator can fetch these bytes, and
 *    they are worth nothing without the wallet: the name is derived from the same secret the key
 *    is. What it buys is that a person can keep their own copy and open their account with their
 *    wallet alone, with this server gone.
 */
export declare function walletSlot(server: string, locator: string): Promise<Uint8Array>;
