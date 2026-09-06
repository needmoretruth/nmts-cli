import type { ExtendWindow } from "./extend-plan.ts";
import type { StorageResource } from "./shared/lib/storage-control/chain.ts";
import { type WalletBalances } from "./wallet.ts";
/** The browser's default rung, and the term one credit buys. A number of EPOCHS, not days. */
export declare const DEFAULT_UPLOAD_EPOCHS = 2;
/** What ONE part costs, as the chain quotes it. Base units throughout. */
export interface PartQuote {
    sealedLen: number;
    /** Storage over time, in FROST. Zero when a held resource supplies the storage. */
    storageFrost: bigint;
    /** The write, in FROST. Charged whoever supplies the storage. */
    writeFrost: bigint;
    /** The relay's tip, in MIST. */
    tipMist: bigint;
}
/** Where a part's storage comes from. */
export type StorageChoice = {
    kind: "buy";
} | {
    kind: "reuse";
    objectId: string;
    /** Cut the resource down to this many bytes first (`fit`), or null to bind it whole. */
    cutToBytes: number | null;
    /** The write cost, which a held resource does not cover. */
    writeFrost: bigint;
    /** What the resource holds beyond this part, once encoded — bound with the file, or left over. */
    leftoverBytes: number;
    resource: StorageResource;
};
/** One part as the register transaction needs it. */
export interface RegisterShape {
    epochs: number;
    storage: {
        kind: "buy";
    } | {
        kind: "reuse";
        objectId: string;
        cutToBytes: number | null;
        writeFrost: bigint;
    };
    part: {
        sealedLen: number;
        blobId: string;
        rootHash: Uint8Array;
        nonce: Uint8Array;
        blobDigest: Uint8Array;
    };
}
/** The chain, as a wallet-paid upload READS it. ⚠ A seam — no flag reaches it. */
export interface WalletUploadReads {
    readWindow(): Promise<ExtendWindow | null>;
    quoteParts(sealedLens: readonly number[], epochs: number): Promise<PartQuote[]>;
    readWallet(address: string): Promise<WalletBalances>;
    /** The fee of ONE register signature, measured by a dry run — or null when it could not be. */
    estimateRegisterGas(input: {
        sender: string;
        sealedLen: number;
        epochs: number;
        storage: RegisterShape["storage"];
    }): Promise<bigint | null>;
    /** The free storage resources the wallet holds. Rejects when they could not be read. */
    readStorage(address: string): Promise<StorageResource[]>;
    /** What a part of this many sealed bytes occupies once encoded — the chain's own number. */
    encodedLength(sender: string, sealedLen: number): Promise<number>;
}
/**
 * How many epochs to buy: what was asked for, or the browser's default, held against the ceiling.
 *
 * ⛔ IT REFUSES RATHER THAN CLAMPS, for the reason `extend-plan.ts` gives: quietly buying fewer
 *    epochs spends money on something nobody asked for.
 */
export declare function chooseUploadEpochs(asked: string | number | undefined, window: ExtendWindow): number;
/** A number of epochs as days, read from the network's own clock. */
export declare function daysOf(window: ExtendWindow, epochs: number): string;
/** What `--storage` asks for. */
export type StorageAsk = {
    mode: "fit";
} | {
    mode: "whole";
} | {
    mode: "object";
    objectId: string;
};
export declare function parseStorageAsk(text: string | undefined): StorageAsk | null;
/**
 * Which held resource supplies this part's storage, and how much of it.
 *
 * ⛔ THE LEFTOVER IS A NUMBER THE PERSON SEES — the owner's rule: registration binds the WHOLE resource,
 *    so `whole` says how many bytes go in with the file, and `fit` cuts first and says what stays
 *    free. `fit` and `whole` pick the smallest usable resource that fits; an object id names one.
 */
export declare function pickResource(ask: StorageAsk, resources: readonly StorageResource[], encodedBytes: number, currentEpoch: number, needUntilEpoch: number, writeFrost: bigint): StorageChoice;
/** The wallet against the price — before the agreement, before any signature. */
export interface UploadBudget {
    readonly address: string;
    readonly walNeededFrost: bigint;
    /** Tips plus the measured register fee per part. The certify fees are on top and unmeasured. */
    readonly suiNeededMist: bigint;
    readonly walFrost: bigint | null;
    readonly suiMist: bigint | null;
    readonly feeMist: bigint | null;
    readonly unread: readonly string[];
    readonly shortfall: string | null;
}
export declare function uploadBudget(input: {
    address: string;
    purse: WalletBalances;
    feeMist: bigint | null;
    quotes: readonly PartQuote[];
    storage: StorageChoice;
}): UploadBudget;
/** WAL for the whole file: storage and write when buying, the write alone on a held resource. */
export declare function walPrice(quotes: readonly PartQuote[], storage: StorageChoice): bigint;
/** The next step when the wallet is short: where to send what, said once. */
export declare function uploadShortfallNextStep(b: UploadBudget): string;
/** The numbers, for a person, in the order somebody deciding needs them. */
export declare function describeUploadReview(say: (line: string) => void, facts: {
    name: string;
    bytes: number;
    parts: number;
    epochs: number;
    days: string;
    endEpoch: number;
    walNeeded: bigint;
    tipMist: bigint;
    storage: StorageChoice;
    heldResources: number | null;
}, budget: UploadBudget): void;
