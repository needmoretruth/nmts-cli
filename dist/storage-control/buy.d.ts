import type { ExtendWindow } from "../extend-plan.ts";
import type { Network } from "../network.ts";
import type { DryRunVerdict, StorageOpShape } from "../storage-control-chain.ts";
import { type WalletBalances } from "../wallet.ts";
import type { SignStorageOp } from "../wallet-sign-seams.ts";
import type { ReshapeContext } from "./reshape.ts";
/** One purchase, in the values it is made of. */
export interface BuyAsk {
    /** The resource's size: encoded bytes, as a listing shows them. */
    sizeBytes: number;
    /** Storage-network epochs from the current one. Default 2, the term `put` buys. */
    epochs?: number | undefined;
}
/** What one purchase would be, priced, before anything is signed. */
export interface BuyReview {
    network: Network;
    /** The wallet that pays and receives the resource. */
    address: string;
    sizeBytes: number;
    epochs: number;
    startEpoch: number;
    endEpoch: number;
    /** WAL it costs, in FROST — storage only; a resource carries no write cost until a blob is written into it. */
    priceFrost: bigint;
    /** The chain fee the dry run measured, in MIST. ⛔ NULL WHEN UNMEASURED, never zero. */
    feeMist: bigint | null;
    /** What the wallet holds. ⛔ NULL IS "NOT READ", never zero. */
    walFrost: bigint | null;
    suiMist: bigint | null;
    /** Set when the wallet is known to be short: both numbers. A real call throws instead of signing. */
    shortfall: string | null;
}
export type BuyOutcome = {
    kind: "review";
    review: BuyReview;
} | {
    kind: "done";
    review: BuyReview;
    digest: string;
    objectId: string | null;
};
/** The chain, as a purchase reads it. ⚠ A seam — a test hands in a table. */
export interface BuyReads {
    readWindow(): Promise<ExtendWindow | null>;
    /** The storage price of a resource of `sizeBytes` encoded bytes for `epochs`, in FROST. */
    price(sizeBytes: number, epochs: number): Promise<bigint>;
    readWallet(address: string): Promise<WalletBalances>;
    walrusPackageId(): Promise<string>;
    walType(): string;
    systemObjectId(): string;
    dryRun(shape: StorageOpShape, sender: string): Promise<DryRunVerdict>;
    /** The storage resource a signed purchase created, or null when the chain did not name one. */
    createdResource(digest: string): Promise<string | null>;
}
/** The chain, the signature and the gate. ⚠ Seams, not options. */
export interface BuySeams {
    reads?: ((network: Network) => BuyReads | Promise<BuyReads>) | undefined;
    sign?: SignStorageOp | undefined;
    onReview?: ((review: BuyReview) => void) | undefined;
    /** ⛔ THE GATE. Throwing here stops the run with nothing signed. */
    agree?: ((review: BuyReview) => void) | undefined;
    dryRun?: boolean | undefined;
}
/** Read, judge, price and — unless somebody stops it — sign one purchase of a storage resource. */
export declare function buyStorage(context: ReshapeContext, ask: BuyAsk, seams?: BuySeams): Promise<BuyOutcome>;
