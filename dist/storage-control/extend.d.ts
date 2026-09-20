import { type Budget } from "../extend-budget.ts";
import { type DaysLeft, type ExpiryStage } from "../expiry.ts";
import { type ExtendPreview, type ExtendReads, type SignExtension } from "../extend-plan.ts";
import type { StorageHints } from "./hints.ts";
import { type AccountSettings } from "../shared/lib/drive/manifest-settings.ts";
/** Where to talk, what opens the list, and whose list it is. */
export interface ExtendInput {
    server: string;
    apiKey: string;
    /** ⛔ The NMTS key. It opens the list and derives the wallet that pays; it goes nowhere else. */
    code: string;
    accountId: string;
    network: string;
}
/**
 * Everything one run worked out, in one shape.
 *
 * ⛔ ONE OBJECT SO TWO ANSWERS CANNOT DISAGREE. The words a person reads and the JSON a program
 *    reads are built from this and from nothing else; when they were assembled separately the day
 *    count in one of them was the count before the extension and in the other the count after.
 */
export interface ExtendFacts {
    file: string;
    itemId: string;
    network: string;
    epoch: number;
    endEpoch: number;
    epochs: number;
    newEndEpoch: number;
    daysLeft: DaysLeft;
    daysLeftAfter: DaysLeft;
    blobs: number;
    /** ⚠ A STRING: base units run past what a JSON number keeps without losing digits. */
    priceFrost: string;
    priceWal: string;
    /** ⛔ Said in the machine-readable answer too. A program spending WAL should not have to infer it. */
    paidFrom: "wallet";
    filesOnTheSameBlobs: number;
    partsThatCannotBeExtended: number;
    /** The address that would sign. */
    wallet: string;
    /** What it holds, as amounts — null when the chain could not say. ⛔ Never zero for unread. */
    walletWal: string | null;
    walletSui: string | null;
    /** The chain fee a dry run measured — null when it could not be measured. */
    feeMist: string | null;
    feeSui: string | null;
}
/** What one extension would buy, and everything the decision to buy it rests on. */
export interface ExtendPlan {
    facts: ExtendFacts;
    itemId: string;
    /** The file's full path in the account, as the list spells it. */
    path: string;
    /** The blobs the transaction would name. */
    objectIds: readonly string[];
    epochs: number;
    /**
     * ⚠ THE WALLET'S NUMBER. `facts.wallet` is that wallet's address — the one the price was measured
     *   against, and the one that signs.
     */
    wallet: number;
    /**
     * How close this file is to running out.
     *
     * ⛔ `later` IS NOT A REFUSAL HERE. Extending early loses nothing — the epochs are added to what
     *    is left — so whether to spend now for time a file does not need yet is the caller's to
     *    decide, and each surface names its own way of saying yes.
     */
    stage: ExpiryStage;
    budget: Budget;
    /** The sealed list's settings, as read for this price. */
    settings: AccountSettings | undefined;
}
/** The chain reads. ⚠ A SEAM, NOT AN OPTION — no flag and no caller argument reaches it. */
export interface ExtendPlanSeams {
    readChain?: ((network: string) => Promise<ExtendReads> | ExtendReads) | undefined;
    /** How many of the storage network's epochs to add. Default `DEFAULT_EXTEND_EPOCHS`. */
    epochs?: string | number | undefined;
    /** Which of this key's wallets pays. Absent = the account's own number, out of the list read here. */
    wallet?: number | undefined;
    /**
     * A wallet OUTSIDE this tool that pays instead — its address, because this is where the price is
     * measured against a balance.
     *
     * ⛔ THE SIGNATURE HAS TO COME FROM THE SAME ADDRESS (`wallet-sign-external.ts`), and the blobs
     *    have to be ones that wallet paid for: extending storage is a payment by whoever holds it.
     */
    payer?: {
        address: string;
    } | undefined;
    /** The instant to measure against. Passed in so one run reports one moment. */
    now: number;
    /** What this caller wants said in a refusal instead of the neutral sentence. */
    hints?: StorageHints | undefined;
}
/**
 * Work out what extending this file would buy and what it would cost, without signing anything.
 *
 * ⛔ NO KEY IS DERIVED FOR SIGNING AND NO SIGNER IS LOADED. Everything here is a read, which is
 *    what lets a price be asked for without an agreement being asked for first.
 */
export declare function planExtension(input: ExtendInput, target: string, seams: ExtendPlanSeams): Promise<ExtendPlan>;
/** What one extension did. ⛔ By the time this exists, the storage IS extended and paid for. */
export interface ExtendOutcome {
    /** The transaction digest — what the server records as the replay guard. */
    digest: string;
    /** Whether the server wrote the new date down. */
    recorded: boolean;
    /** True when the server had already recorded this digest, so nothing was written twice. */
    replay: boolean;
    /**
     * Why the date was not written down, in the words the failure gave. Null when it was.
     *
     * ⛔ IT IS NOT AN EXCEPTION, and that is the whole point: the money is already spent, so a caller
     *    that saw a throw here would reasonably try again — and trying again pays again.
     */
    notRecorded: string | null;
}
/** The signature, and the one moment a caller may want between it and the server. ⚠ Seams. */
export interface ExtendApplySeams {
    sign?: SignExtension | undefined;
    /** Told the instant the signature exists — before the server is asked to write the date down. */
    onSigned?: ((digest: string) => void) | undefined;
}
/**
 * Buy it. ⛔ THIS SIGNS, and nothing below this line can be undone by anybody, NMTS included.
 *
 * Nothing here asks whether the caller meant it: the price, both balances and any shortfall are in
 * the plan, and calling this is the answer.
 */
export declare function applyExtension(input: ExtendInput, plan: ExtendPlan, seams?: ExtendApplySeams): Promise<ExtendOutcome>;
/** Why a file has nothing to extend, said as the two different things it can be. */
export declare function nothingToExtend(preview: ExtendPreview): string;
