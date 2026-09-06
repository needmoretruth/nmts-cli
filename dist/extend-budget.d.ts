import type { ExtendReads } from "./extend-plan.ts";
export interface Budget {
    /** The address that would sign — the one `nmts wallet` prints and the one somebody funds. */
    readonly address: string;
    /** What the extension costs, in FROST. */
    readonly priceFrost: bigint;
    /** Held now, in base units — or null when the chain could not answer. */
    readonly walFrost: bigint | null;
    readonly suiMist: bigint | null;
    /** The chain fee the dry run measured, in MIST — or null when it could not be measured. */
    readonly feeMist: bigint | null;
    /** Why each unread balance could not be read, in the words the chain gave. */
    readonly unread: readonly string[];
    /** What the wallet is known to be short of, or null when nothing known says it is short. */
    readonly shortfall: string | null;
}
/** Read the wallet and measure the fee, then say whether the known numbers cover the purchase. */
export declare function readBudget(reads: ExtendReads, input: {
    address: string;
    objectIds: readonly string[];
    epochs: number;
    priceFrost: bigint;
}): Promise<Budget>;
/** The budget as the machine-readable answer carries it. ⚠ Base units are strings — see `Facts`. */
export declare function budgetFacts(b: Budget): {
    wallet: string;
    walletWal: string | null;
    walletSui: string | null;
    feeMist: string | null;
    feeSui: string | null;
};
/** The next step when the wallet is short: where to send what, said once. */
export declare function shortfallNextStep(b: Budget): string;
/** The fee and the wallet, for a person, after the price. */
export declare function describeBudget(say: (line: string) => void, b: Budget): void;
