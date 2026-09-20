import type { Network } from "../network.ts";
import type { StorageResource } from "../shared/lib/storage-control/chain.ts";
import type { StorageOpShape, StorageOpsReads } from "../storage-control-chain.ts";
import type { WalletAction } from "../wallet-grant.ts";
import type { SignStorageOp } from "../wallet-sign-seams.ts";
import type { StorageHints } from "./hints.ts";
/** The three things that can be done to a resource the wallet holds free. */
export type StorageOp = "split" | "merge" | "transfer";
/**
 * One request, in the values it is made of rather than in what anybody typed.
 *
 * ⚠ `keepEpochs` IS A COUNT AND THE CHAIN TAKES AN EPOCH. The resource keeps its first
 *   `keepEpochs` epochs; which absolute epoch that is depends on where it starts, which is a fact
 *   read from the chain below rather than one a caller should have to work out.
 */
export type StorageOpAsk = {
    kind: "splitSize";
    objectId: string;
    keepBytes: number;
} | {
    kind: "splitEpochs";
    objectId: string;
    keepEpochs: number;
} | {
    kind: "merge";
    first: string;
    second: string;
} | {
    kind: "transfer";
    objectId: string;
    to: string;
};
/** A resource as the chain would hold it. A resource that does not exist yet has no id. */
export interface StorageShape {
    sizeBytes: number;
    startEpoch: number;
    endEpoch: number;
}
/** What one change leaves behind — the numbers, without a word of prose about them. */
export type StorageOpResult = {
    kind: "split";
    keeps: StorageShape;
    creates: StorageShape;
} | {
    kind: "merge";
    becomes: StorageShape;
    consumed: string;
    how: "amount" | "periods";
} | {
    kind: "transfer";
    moves: StorageShape;
    to: string;
};
/** One request, judged: what the chain is asked for, what it needs, and what it would leave. */
export interface StorageOpPlan {
    op: StorageOp;
    /** The transaction shape — what is priced, and what is signed. One builder for both. */
    shape: StorageOpShape;
    /** The wallet unlock this needs: `reshape` for cutting and joining, `give` for handing over. */
    action: WalletAction;
    /** The resources it is about, as the chain has them. */
    named: readonly StorageResource[];
    result: StorageOpResult;
}
/**
 * Judge one request against the resources this wallet actually holds.
 *
 * ⛔ EVERY REFUSAL HAPPENS HERE, BEFORE THE CHAIN IS ASKED ANYTHING. Letting the contract refuse it
 *    instead leaves somebody having paid gas with no idea why — the rule the browser's own
 *    judgement (`shared/lib/storage-control/plan.ts`) was written for.
 */
export declare function planStorageOp(held: readonly StorageResource[], ask: StorageOpAsk, hints?: StorageHints): StorageOpPlan;
/** What one change would do, priced, before anything is signed. */
export interface StorageOpReview {
    plan: StorageOpPlan;
    /** The wallet whose resources these are — the one that would sign. */
    address: string;
    network: Network;
    currentEpoch: number | null;
    /**
     * The chain fee the dry run measured, in MIST — or null when it could not be measured.
     * ⛔ NEVER ZERO FOR "UNKNOWN": the fee is charged with the signature either way.
     */
    feeMist: bigint | null;
}
/** Stopped at the review, or done and signed. */
export type ReshapeOutcome = {
    kind: "review";
    review: StorageOpReview;
} | {
    kind: "done";
    review: StorageOpReview;
    digest: string;
};
/** Whose resources these are: the wallet that holds them, and the key that derives it. */
export interface ReshapeContext {
    network: Network;
    /** ⛔ The NMTS key. It never leaves this process: it derives the wallet and nothing else. */
    code: string;
    /** Which of this key's wallets holds the resources. */
    wallet: number;
    /** That wallet's address — read, priced and signed with as one. */
    address: string;
}
/** The chain, the signature, and the two places a caller gets a word in. ⚠ Seams, not options. */
export interface ReshapeSeams {
    reads?: ((network: Network) => StorageOpsReads) | undefined;
    /** ⛔ SEPARATE FROM THE READS so a test can prove the review stops before this. */
    sign?: SignStorageOp | undefined;
    /** Told once the change is priced, and before anything is signed. */
    onReview?: ((review: StorageOpReview) => void) | undefined;
    /** ⛔ THE GATE. Throwing here stops the run with nothing signed. */
    agree?: ((review: StorageOpReview) => void) | undefined;
    /** Stop at the review. Nothing is signed and no signer is even loaded. */
    dryRun?: boolean | undefined;
    /** What this caller wants said in a refusal instead of the neutral sentence. */
    hints?: StorageHints | undefined;
}
/** Read, judge, price and — unless somebody stops it — sign one change to a storage resource. */
export declare function reshapeStorage(context: ReshapeContext, ask: StorageOpAsk, seams?: ReshapeSeams): Promise<ReshapeOutcome>;
